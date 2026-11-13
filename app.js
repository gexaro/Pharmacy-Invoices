
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

  let returnInvoices = [];

  /* =====================================
     General helpers
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
    document.querySelectorAll('[id^="page-"]').forEach(page => {
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

    if (pageName === "return") {
      loadReturnInvoices();
    }

    window.scrollTo({
      top: 0,
      behavior: "auto"
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
      localStorage.setItem("pharmacy-invoices-theme", theme);
    } catch (error) {
      console.warn("Theme preference could not be saved:", error);
    }
  }

  function initializeTheme() {
    let theme = "light";

    try {
      theme = localStorage.getItem("pharmacy-invoices-theme") || "light";
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

    invoices.forEach(invoice => {
      if (invoice.category === "medicine") {
        balances.medicine += numberValue(invoice.total);
      } else if (invoice.category === "general") {
        balances.general += numberValue(invoice.total);
      }
    });

    returns.forEach(item => {
      if (item.category === "medicine") {
        balances.medicine -= numberValue(item.amount);
      } else if (item.category === "general") {
        balances.general -= numberValue(item.amount);
      }
    });

    payments.forEach(payment => {
      balances.medicine -= numberValue(payment.medicineDiscount);
      balances.general -= numberValue(payment.generalDiscount);

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

    // Negative balances are preserved as supplier credit.
    currentBalances = {
      medicine: roundMoney(balances.medicine),
      general: roundMoney(balances.general)
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

    const monthlyInvoices = invoices.filter(item => item.month === month);
    const monthlyReturns = returns.filter(item => item.month === month);
    const monthlyPayments = payments.filter(item => item.month === month);

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

    if (value < 0 || value > 100) return null;

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

    // Discounts apply only to positive category balances.
    const medicineAfter = roundMoney(
      medicineBalance > 0
        ? medicineBalance * (1 - medicineRate / 100)
        : medicineBalance
    );

    const generalAfter = roundMoney(
      generalBalance > 0
        ? generalBalance * (1 - generalRate / 100)
        : generalBalance
    );

    const due = roundMoney(medicineAfter + generalAfter);

    if ($("medicineAfterDiscount")) {
      $("medicineAfterDiscount").textContent = money(medicineAfter);
    }

    if ($("generalAfterDiscount")) {
      $("generalAfterDiscount").textContent = money(generalAfter);
    }

    if ($("paymentDue")) {
      $("paymentDue").textContent = money(Math.max(0, due));
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

    if (amount <= 0) {
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
      const balances = await calculateBalances();

      const medicineBefore = balances.medicine;
      const generalBefore = balances.general;

      const medicineDiscount = roundMoney(
        Math.max(0, medicineBefore) * medicineRate / 100
      );

      const generalDiscount = roundMoney(
        Math.max(0, generalBefore) * generalRate / 100
      );

      const medicineAfter = roundMoney(
        medicineBefore - medicineDiscount
      );

      const generalAfter = roundMoney(
        generalBefore - generalDiscount
      );

      // Supplier credit offsets the positive balances.
      const totalDue = roundMoney(
        medicineAfter + generalAfter
      );

      if (totalDue <= 0) {
        notify("لا يوجد مبلغ مستحق للتسديد؛ يوجد رصيد دائن أو لا يوجد دين");
        return;
      }

      if (amount > totalDue + 0.01) {
        notify("مبلغ التسديد أكبر من المستحق بعد الخصم");
        return;
      }

      const positiveTotal =
        Math.max(0, medicineAfter) +
        Math.max(0, generalAfter);

      let medicinePaid = 0;
      let generalPaid = 0;

      if (positiveTotal > 0) {
        medicinePaid = roundMoney(
          amount * Math.max(0, medicineAfter) / positiveTotal
        );

        generalPaid = roundMoney(amount - medicinePaid);
      }

      if (medicinePaid > Math.max(0, medicineAfter)) {
        const excess = medicinePaid - Math.max(0, medicineAfter);
        medicinePaid = Math.max(0, medicineAfter);
        generalPaid = roundMoney(generalPaid + excess);
      }

      if (generalPaid > Math.max(0, generalAfter)) {
        const excess = generalPaid - Math.max(0, generalAfter);
        generalPaid = Math.max(0, generalAfter);
        medicinePaid = roundMoney(medicinePaid + excess);
      }

      if (
        medicinePaid > Math.max(0, medicineAfter) + 0.01 ||
        generalPaid > Math.max(0, generalAfter) + 0.01
      ) {
        throw new Error("تعذر توزيع مبلغ التسديد على الفئتين");
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
      if ($("paymentDate")) $("paymentDate").value = todayString();

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
     Returns: invoice selector
  ===================================== */

  async function loadReturnInvoices() {
    const select = $("returnInvoice");
    const category = $("returnType")?.value || "medicine";

    if (!select) return;

    try {
      const invoices = await dbGetAll(DB_STORES.INVOICES);

      returnInvoices = invoices.filter(
        invoice => invoice.category === category
      );

      const previousValue = select.value;

      select.replaceChildren();

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "بدون ربط بفاتورة";
      select.appendChild(emptyOption);

      returnInvoices
        .sort((a, b) =>
          String(b.date || "").localeCompare(String(a.date || ""))
        )
        .forEach(invoice => {
          const option = document.createElement("option");

          option.value = String(invoice.id);

          option.textContent =
            `${invoice.invoiceNumber || "بدون رقم"} — ` +
            `${invoice.date || ""} — ${money(invoice.total)}`;

          select.appendChild(option);
        });

      if (
        previousValue &&
        returnInvoices.some(item => String(item.id) === previousValue)
      ) {
        select.value = previousValue;
      }

    } catch (error) {
      console.error("Return invoices loading error:", error);
      notify("تعذر تحميل قائمة الفواتير");
    }
  }

  async function getReturnCapacity(category, invoiceId) {
    const [invoices, returns] = await Promise.all([
      dbGetAll(DB_STORES.INVOICES),
      dbGetAll(DB_STORES.RETURNS)
    ]);

    if (invoiceId) {
      const invoice = invoices.find(
        item => Number(item.id) === Number(invoiceId)
      );

      if (!invoice || invoice.category !== category) {
        return 0;
      }

      const previousReturns = returns
        .filter(item =>
          Number(item.invoiceId) === Number(invoiceId) ||
          (
            !item.invoiceId &&
            item.invoiceNumber &&
            item.invoiceNumber === invoice.invoiceNumber &&
            item.category === category
          )
        )
        .reduce((total, item) => total + numberValue(item.amount), 0);

      return roundMoney(
        Math.max(0, numberValue(invoice.total) - previousReturns)
      );
    }

    const categoryPurchases = invoices
      .filter(item => item.category === category)
      .reduce((total, item) => total + numberValue(item.total), 0);

    const categoryReturns = returns
      .filter(item => item.category === category)
      .reduce((total, item) => total + numberValue(item.amount), 0);

    return roundMoney(
      Math.max(0, categoryPurchases - categoryReturns)
    );
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

    const invoiceIdValue = $("returnInvoice")?.value || "";
    const invoiceId = invoiceIdValue ? Number(invoiceIdValue) : null;

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
      const capacity = await getReturnCapacity(category, invoiceId);

      if (amount > capacity + 0.01) {
        notify(
          `قيمة المردود أكبر من قيمة المشتريات المتاحة للمردود (${money(capacity)})`
        );
        return;
      }

      let invoiceNumber = "";

      if (invoiceId) {
        const invoice = await dbGet(DB_STORES.INVOICES, invoiceId);

        if (!invoice || invoice.category !== category) {
          notify("الفاتورة المحددة غير صالحة");
          return;
        }

        invoiceNumber = invoice.invoiceNumber || "";
      }

      const returnRecord = {
        category,
        date,
        month: date.slice(0, 7),

        invoiceId,
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
      if ($("returnDate")) $("returnDate").value = todayString();

      await refreshDashboard();
      await loadReturnInvoices();

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
      await loadReturnInvoices();

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
      await loadReturnInvoices();

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
    [
      "invoiceDate",
      "returnDate",
      "paymentDate"
    ].forEach(id => {
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

    $("returnType")?.addEventListener("change", loadReturnInvoices);

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

      if ($("page-return")?.classList.contains("active")) {
        await loadReturnInvoices();
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
      await loadReturnInvoices();

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
    saveReturn,
    loadReturnInvoices
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  PMApp.initialize();
});
