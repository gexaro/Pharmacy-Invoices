
"use strict";

/* =====================================
   Pharmacy Purchase Manager
   Main Application
===================================== */

const PMApp = (() => {

  const $ = (id) => document.getElementById(id);

  let initialized = false;
  let currentBalances = {
    medicine: 0,
    general: 0
  };

  /* =====================================
     Helpers
  ===================================== */

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundMoney(value) {
    return Math.round((numberValue(value) + Number.EPSILON) * 100) / 100;
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2
    }).format(numberValue(value)) + " د.ع";
  }

  function todayString() {
    const date = new Date();

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function currentMonth() {
    return todayString().slice(0, 7);
  }

  function notify(message) {
    const toast = $("toast");

    if (!toast) {
      alert(message);
      return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(notify.timer);

    notify.timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  window.showToast = notify;

  function categoryName(category) {
    return category === "medicine"
      ? "الأدوية"
      : "قديم ومواد عامة";
  }

  function setButtonLoading(button, loading, originalText) {
    if (!button) return;

    button.disabled = loading;
    button.textContent = loading ? "جارٍ التنفيذ..." : originalText;
  }

  /* =====================================
     Navigation
  ===================================== */

  function navigate(pageName) {
    const pages = document.querySelectorAll('[id^="page-"]');

    pages.forEach(page => {
      const active = page.id === `page-${pageName}`;

      page.classList.toggle("active", active);
      page.hidden = !active;
    });

    document.querySelectorAll("[data-page]").forEach(button => {
      const active = button.dataset.page === pageName;

      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    if (pageName === "archive") {
      PMReports.loadArchive($("archiveSearch")?.value || "");
    }

    if (pageName === "reports") {
      PMReports.loadReport();
    }

    if (pageName === "payment") {
      refreshPaymentPreview();
    }

    window.scrollTo({
      top: 0,
      behavior: "instant"
    });
  }

  function initializeNavigation() {
    document.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => {
        navigate(button.dataset.page);
      });
    });

    navigate("invoice");
  }

  /* =====================================
     Theme
  ===================================== */

  function applyTheme(theme) {
    const dark = theme === "dark";

    document.body.classList.toggle("dark-theme", dark);

    const icon = $("themeIcon");

    if (icon) {
      icon.textContent = dark ? "☀️" : "🌙";
    }

    const toggle = $("themeToggle");

    if (toggle) {
      toggle.setAttribute(
        "aria-label",
        dark ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي"
      );
    }

    const meta = document.querySelector('meta[name="theme-color"]');

    if (meta) {
      meta.content = dark ? "#111B2E" : "#244638";
    }

    try {
      localStorage.setItem("expiry-manager-theme", theme);
    } catch (error) {
      console.warn("Theme preference could not be saved:", error);
    }
  }

  function initializeTheme() {
    let theme = "light";

    try {
      theme = localStorage.getItem("expiry-manager-theme") || "light";
    } catch (error) {
      console.warn("Theme preference unavailable:", error);
    }

    applyTheme(theme);

    $("themeToggle")?.addEventListener("click", () => {
      const dark = document.body.classList.contains("dark-theme");

      applyTheme(dark ? "light" : "dark");
    });
  }

  /* =====================================
     Supplier balance calculations
  ===================================== */

  async function calculateBalances() {
    const [invoices, returns, payments] = await Promise.all([
      dbGetAll(DB_STORES.INVOICES),
      dbGetAll(DB_STORES.RETURNS),
      dbGetAll(DB_STORES.PAYMENTS)
    ]);

    const balances = {
      medicine: 0,
      general: 0
    };

    // Add original invoice values.
    invoices.forEach(invoice => {
      if (invoice.category === "medicine") {
        balances.medicine += numberValue(invoice.total);
      } else if (invoice.category === "general") {
        balances.general += numberValue(invoice.total);
      }
    });

    // Returns reduce the corresponding category balance.
    returns.forEach(item => {
      if (item.category === "medicine") {
        balances.medicine -= numberValue(item.amount);
      } else if (item.category === "general") {
        balances.general -= numberValue(item.amount);
      }
    });

    // Subtract payments and discounts already recorded.
    payments.forEach(payment => {
      balances.medicine -= numberValue(payment.medicineDiscount);
      balances.general -= numberValue(payment.generalDiscount);

      // New payment records contain category-specific allocations.
      if (
        payment.medicinePaid !== undefined ||
        payment.generalPaid !== undefined
      ) {
        balances.medicine -= numberValue(payment.medicinePaid);
        balances.general -= numberValue(payment.generalPaid);
      } else {
        // Compatibility with older payment records.
        const totalPaid = numberValue(payment.amount);

        const oldMedicine = numberValue(payment.medicineAfterDiscount);
        const oldGeneral = numberValue(payment.generalAfterDiscount);
        const total = oldMedicine + oldGeneral;

        if (total > 0) {
          balances.medicine -= totalPaid * (oldMedicine / total);
          balances.general -= totalPaid * (oldGeneral / total);
        } else {
          balances.medicine -= totalPaid;
        }
      }
    });

    currentBalances = {
      medicine: roundMoney(Math.max(0, balances.medicine)),
      general: roundMoney(Math.max(0, balances.general))
    };

    return currentBalances;
  }

  /* =====================================
     Dashboard
  ===================================== */

  async function refreshDashboard() {
    const balances = await calculateBalances();

    const [invoices, returns, payments] = await Promise.all([
      dbGetAll(DB_STORES.INVOICES),
      dbGetAll(DB_STORES.RETURNS),
      dbGetAll(DB_STORES.PAYMENTS)
    ]);

    const month = currentMonth();

    const monthlyInvoices = invoices.filter(
      item => item.month === month
    );

    const monthlyReturns = returns.filter(
      item => item.month === month
    );

    const monthlyPayments = payments.filter(
      item => item.month === month
    );

    const monthlyPurchases = monthlyInvoices.reduce(
      (sum, item) => sum + numberValue(item.total),
      0
    );

    const monthlyReturnsTotal = monthlyReturns.reduce(
      (sum, item) => sum + numberValue(item.amount),
      0
    );

    const monthlyPaymentsTotal = monthlyPayments.reduce(
      (sum, item) => sum + numberValue(item.amount),
      0
    );

    if ($("supplierBalance")) {
      $("supplierBalance").textContent = money(
        balances.medicine + balances.general
      );
    }

    if ($("monthlyPurchases")) {
      $("monthlyPurchases").textContent = money(monthlyPurchases);
    }

    if ($("monthlyReturns")) {
      $("monthlyReturns").textContent = money(monthlyReturnsTotal);
    }

    if ($("monthlyPayments")) {
      $("monthlyPayments").textContent = money(monthlyPaymentsTotal);
    }

    return balances;
  }

  /* =====================================
     Payment preview
  ===================================== */

  function getDiscountRate(id) {
    const value = numberValue($(id)?.value);

    if (value < 0 || value > 100) {
      return null;
    }

    return value;
  }

  function refreshPaymentPreview() {
    const medicineRate = getDiscountRate("medicineDiscount");
    const generalRate = getDiscountRate("generalDiscount");

    const medicineBalance = currentBalances.medicine;
    const generalBalance = currentBalances.general;

    if ($("medicineBalance")) {
      $("medicineBalance").textContent = money(medicineBalance);
    }

    if ($("generalBalance")) {
      $("generalBalance").textContent = money(generalBalance);
    }

    if ($("totalBalance")) {
      $("totalBalance").textContent = money(
        medicineBalance + generalBalance
      );
    }

    if (medicineRate === null || generalRate === null) {
      if ($("paymentDue")) {
        $("paymentDue").textContent = "نسبة الخصم يجب أن تكون بين 0 و100";
      }

      return;
    }

    const medicineAfter = roundMoney(
      medicineBalance * (1 - medicineRate / 100)
    );

    const generalAfter = roundMoney(
      generalBalance * (1 - generalRate / 100)
    );

    const due = roundMoney(medicineAfter + generalAfter);

    if ($("medicineAfterDiscount")) {
      $("medicineAfterDiscount").textContent = money(medicineAfter);
    }

    if ($("generalAfterDiscount")) {
      $("generalAfterDiscount").textContent = money(generalAfter);
    }

    if ($("paymentDue")) {
      $("paymentDue").textContent = money(due);
    }
  }

  /* =====================================
     Save payment
  ===================================== */

  async function savePayment() {
    const button = $("savePaymentBtn");

    if (button?.disabled) return;

    const medicineRate = getDiscountRate("medicineDiscount");
    const generalRate = getDiscountRate("generalDiscount");

    if (medicineRate === null || generalRate === null) {
      notify("نسبة الخصم يجب أن تكون بين 0 و100");
      return;
    }

    const amount = roundMoney(numberValue($("paymentAmount")?.value));

    if (!Number.isFinite(amount) || amount <= 0) {
      notify("أدخل مبلغ تسديد صحيحاً");
      return;
    }

    const paymentDate = $("paymentDate")?.value || todayString();

    if (!paymentDate) {
      notify("حدد تاريخ التسديد");
      return;
    }

    setButtonLoading(button, true, "حفظ التسديد");

    try {
      // Always calculate the latest balances before recording payment.
      const balances = await calculateBalances();

      const medicineBefore = balances.medicine;
      const generalBefore = balances.general;

      const medicineDiscount = roundMoney(
        medicineBefore * medicineRate / 100
      );

      const generalDiscount = roundMoney(
        generalBefore * generalRate / 100
      );

      const medicineAfter = roundMoney(
        medicineBefore - medicineDiscount
      );

      const generalAfter = roundMoney(
        generalBefore - generalDiscount
      );

      const totalDue = roundMoney(medicineAfter + generalAfter);

      if (totalDue <= 0) {
        notify("لا يوجد رصيد مستحق للتسديد");
        return;
      }

      if (amount > totalDue + 0.01) {
        notify("مبلغ التسديد أكبر من المستحق بعد الخصم");
        return;
      }

      // Allocate partial payment proportionally between categories.
      let medicinePaid = 0;
      let generalPaid = 0;

      if (totalDue > 0) {
        medicinePaid = roundMoney(
          amount * medicineAfter / totalDue
        );

        generalPaid = roundMoney(amount - medicinePaid);
      }

      // Avoid tiny rounding differences exceeding a category balance.
      if (medicinePaid > medicineAfter) {
        const excess = medicinePaid - medicineAfter;
        medicinePaid = medicineAfter;
        generalPaid = roundMoney(generalPaid + excess);
      }

      if (generalPaid > generalAfter) {
        const excess = generalPaid - generalAfter;
        generalPaid = generalAfter;
        medicinePaid = roundMoney(medicinePaid + excess);
      }

      const payment = {
        date: paymentDate,
        month: paymentDate.slice(0, 7),

        amount,

        medicineBalanceBefore: medicineBefore,
        generalBalanceBefore: generalBefore,

        medicineDiscountRate: medicineRate,
        generalDiscountRate: generalRate,

        medicineDiscount,
        generalDiscount,

        medicineAfterDiscount: medicineAfter,
        generalAfterDiscount: generalAfter,

        medicinePaid,
        generalPaid,

        totalDiscount: roundMoney(
          medicineDiscount + generalDiscount
        ),

        totalDue,

        remainingAfterPayment: roundMoney(totalDue - amount),

        notes: $("paymentNotes")?.value.trim() || "",

        createdAt: new Date().toISOString()
      };

      await dbAdd(DB_STORES.PAYMENTS, payment);

      if ($("paymentAmount")) $("paymentAmount").value = "";
      if ($("paymentNotes")) $("paymentNotes").value = "";

      if ($("paymentDate")) {
        $("paymentDate").value = todayString();
      }

      if ($("medicineDiscount")) $("medicineDiscount").value = "0";
      if ($("generalDiscount")) $("generalDiscount").value = "0";

      await refreshDashboard();
      refreshPaymentPreview();

      notify("تم تسجيل التسديد بنجاح");

      window.dispatchEvent(
        new CustomEvent("pm:datachanged", {
          detail: { type: "payment" }
        })
      );

    } catch (error) {
      console.error("Payment error:", error);
      notify("تعذر تسجيل التسديد: " + error.message);

    } finally {
      setButtonLoading(button, false, "حفظ التسديد");
    }
  }

  /* =====================================
     Save return
  ===================================== */

  async function saveReturn() {
    const button = $("saveReturnBtn");

    if (button?.disabled) return;

    const category = $("returnType")?.value || "";
    const date = $("returnDate")?.value || todayString();
    const amount = roundMoney(numberValue($("returnAmount")?.value));

    const invoiceNumber = $("returnInvoice")?.value.trim() || "";
    const returnNumber = $("returnNumber")?.value.trim() || "";
    const notes = $("returnNotes")?.value.trim() || "";

    if (!["medicine", "general"].includes(category)) {
      notify("اختر فئة المردود");
      return;
    }

    if (!date) {
      notify("حدد تاريخ المردود");
      return;
    }

    if (amount <= 0) {
      notify("أدخل قيمة مردود صحيحة");
      return;
    }

    setButtonLoading(button, true, "حفظ المردود");

    try {
      const balances = await calculateBalances();
      const availableBalance = balances[category];

      if (amount > availableBalance + 0.01) {
        notify("قيمة المردود أكبر من رصيد الفئة المتاح");
        return;
      }

      const returnRecord = {
        category,
        date,
        month: date.slice(0, 7),

        invoiceNumber,
        returnNumber,

        amount,
        notes,

        createdAt: new Date().toISOString()
      };

      await dbAdd(DB_STORES.RETURNS, returnRecord);

      if ($("returnAmount")) $("returnAmount").value = "";
      if ($("returnInvoice")) $("returnInvoice").value = "";
      if ($("returnNumber")) $("returnNumber").value = "";
      if ($("returnNotes")) $("returnNotes").value = "";

      if ($("returnDate")) {
        $("returnDate").value = todayString();
      }

      await refreshDashboard();

      notify("تم حفظ المردود بنجاح");

      window.dispatchEvent(
        new CustomEvent("pm:datachanged", {
          detail: { type: "return" }
        })
      );

    } catch (error) {
      console.error("Return error:", error);
      notify("تعذر حفظ المردود: " + error.message);

    } finally {
      setButtonLoading(button, false, "حفظ المردود");
    }
  }

  /* =====================================
     Supplier settings
  ===================================== */

  async function loadSettings() {
    const supplierName = await dbGetSetting(
      "supplierName",
      "المورد الرئيسي"
    );

    if ($("supplierName")) {
      $("supplierName").value = supplierName;
    }
  }

  async function saveSettings() {
    const name = $("supplierName")?.value.trim() || "";

    if (!name) {
      notify("أدخل اسم المورد");
      return;
    }

    try {
      await dbSaveSetting("supplierName", name);
      notify("تم حفظ الإعدادات");

    } catch (error) {
      console.error("Settings error:", error);
      notify("تعذر حفظ الإعدادات");
    }
  }

  /* =====================================
     Backup
  ===================================== */

  async function createBackup() {
    const button = $("backupBtn");

    setButtonLoading(button, true, "إنشاء نسخة احتياطية");

    try {
      const backup = await dbExportBackup();

      const blob = new Blob(
        [JSON.stringify(backup, null, 2)],
        { type: "application/json;charset=utf-8" }
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `pharmacy-backup-${todayString()}.json`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);

      notify("تم إنشاء النسخة الاحتياطية");

    } catch (error) {
      console.error("Backup error:", error);
      notify("تعذر إنشاء النسخة الاحتياطية");

    } finally {
      setButtonLoading(button, false, "إنشاء نسخة احتياطية");
    }
  }

  /* =====================================
     Restore backup
  ===================================== */

  async function restoreBackup() {
    const fileInput = $("restoreFile");
    const button = $("restoreBtn");

    const file = fileInput?.files?.[0];

    if (!file) {
      notify("اختر ملف النسخة الاحتياطية أولاً");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".json")) {
      notify("الملف يجب أن يكون بصيغة JSON");
      return;
    }

    const confirmed = confirm(
      "استعادة النسخة الاحتياطية ستستبدل البيانات الحالية. هل تريد المتابعة؟"
    );

    if (!confirmed) return;

    setButtonLoading(button, true, "استعادة النسخة");

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!validateBackup(backup)) {
        throw new Error("ملف النسخة الاحتياطية غير صالح");
      }

      await dbImportBackup(backup);

      fileInput.value = "";

      await refreshDashboard();
      await loadSettings();

      await PMReports.loadReport();
      await PMReports.loadArchive("");

      refreshPaymentPreview();

      notify("تمت استعادة البيانات بنجاح");

    } catch (error) {
      console.error("Restore error:", error);
      notify("تعذرت الاستعادة: " + error.message);

    } finally {
      setButtonLoading(button, false, "استعادة النسخة");
    }
  }

  /* =====================================
     Clear all data
  ===================================== */

  async function clearAllData() {
    const confirmed = confirm(
      "تحذير: سيتم حذف جميع الفواتير والمردودات والتسديدات والإعدادات نهائياً. هل أنت متأكد؟"
    );

    if (!confirmed) return;

    const secondConfirm = confirm(
      "هذا الإجراء لا يمكن التراجع عنه. هل تريد حذف جميع البيانات فعلاً؟"
    );

    if (!secondConfirm) return;

    const button = $("clearDataBtn");

    setButtonLoading(button, true, "حذف جميع البيانات");

    try {
      await dbClearAll();

      await refreshDashboard();
      await loadSettings();

      await PMReports.loadReport();
      await PMReports.loadArchive("");

      refreshPaymentPreview();

      notify("تم حذف جميع البيانات");

    } catch (error) {
      console.error("Clear data error:", error);
      notify("تعذر حذف البيانات");

    } finally {
      setButtonLoading(button, false, "حذف جميع البيانات");
    }
  }

  /* =====================================
     Date defaults
  ===================================== */

  function initializeDates() {
    const dateIds = [
      "invoiceDate",
      "returnDate",
      "paymentDate"
    ];

    dateIds.forEach(id => {
      const input = $(id);

      if (input && !input.value) {
        input.value = todayString();
      }
    });

    if ($("reportMonth") && !$("reportMonth").value) {
      $("reportMonth").value = currentMonth();
    }
  }

  /* =====================================
     Event bindings
  ===================================== */

  function initializeEvents() {
    $("saveReturnBtn")?.addEventListener("click", saveReturn);

    $("savePaymentBtn")?.addEventListener("click", savePayment);

    $("saveSettingsBtn")?.addEventListener("click", saveSettings);

    $("backupBtn")?.addEventListener("click", createBackup);

    $("restoreBtn")?.addEventListener("click", restoreBackup);

    $("clearDataBtn")?.addEventListener("click", clearAllData);

    $("medicineDiscount")?.addEventListener(
      "input",
      refreshPaymentPreview
    );

    $("generalDiscount")?.addEventListener(
      "input",
      refreshPaymentPreview
    );

    window.addEventListener("pm:datachanged", async () => {
      await refreshDashboard();
      refreshPaymentPreview();

      if ($("page-reports")?.classList.contains("active")) {
        await PMReports.loadReport();
      }

      if ($("page-archive")?.classList.contains("active")) {
        await PMReports.loadArchive($("archiveSearch")?.value || "");
      }
    });
  }

  /* =====================================
     Initialize application
  ===================================== */

  async function initialize() {
    if (initialized) return;

    initialized = true;

    try {
      await dbInitialize();

      initializeTheme();
      initializeNavigation();
      initializeDates();
      initializeEvents();

      await loadSettings();
      await refreshDashboard();

      refreshPaymentPreview();

      await PMReports.loadReport();

      console.log("Pharmacy Purchase Manager initialized");

    } catch (error) {
      console.error("Application initialization error:", error);
      notify("حدث خطأ أثناء تشغيل التطبيق: " + error.message);
    }
  }

  return {
    initialize,
    navigate,
    refreshDashboard,
    calculateBalances,
    refreshPaymentPreview,
    savePayment,
    saveReturn
  };

})();

document.addEventListener("DOMContentLoaded", () => {
  PMApp.initialize();
});
