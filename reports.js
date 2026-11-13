
"use strict";

/* =====================================
   Reports & Archive
   Pharmacy Purchase Manager
===================================== */

const PMReports = (() => {
  let currentInvoices = [];
  let currentReturns = [];
  let currentPayments = [];

  const $ = (id) => document.getElementById(id);

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2
    }).format(Number(value) || 0) + " د.ع";
  }

  function quantity(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  function categoryName(category) {
    if (category === "medicine") return "أدوية";
    if (category === "general") return "قديم ومواد عامة";
    return "—";
  }

  function formatDate(value) {
    if (!value) return "—";

    const parts = String(value).split("-");
    if (parts.length !== 3) return String(value);

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function createCell(value, parent, className = "") {
    const cell = document.createElement("td");
    cell.textContent = value ?? "";

    if (className) cell.className = className;

    parent.appendChild(cell);
    return cell;
  }

  function createEmptyRow(tbody, colspan, message) {
    if (!tbody) return;

    tbody.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = colspan;
    cell.className = "empty-cell";
    cell.textContent = message;

    row.appendChild(cell);
    tbody.appendChild(row);
  }

  function getMonth() {
    return $("reportMonth")?.value || dbGetCurrentMonth();
  }

  function sum(values, callback) {
    return values.reduce(
      (total, item) => total + (Number(callback(item)) || 0),
      0
    );
  }

  function getCategoryInvoices(category) {
    return currentInvoices.filter(
      invoice => invoice.category === category
    );
  }

  function getCategoryTotal(category) {
    return sum(
      getCategoryInvoices(category),
      invoice => invoice.total
    );
  }

  function getCategoryItems(category) {
    return getCategoryInvoices(category).flatMap(
      invoice => Array.isArray(invoice.items) ? invoice.items : []
    );
  }

  function getItemStats(category) {
    const items = getCategoryItems(category);

    return {
      count: items.length,
      paid: sum(items, item => item.paidQty),
      bonus: sum(items, item => item.bonusQty),
      received: sum(items, item =>
        item.totalQty ??
        ((Number(item.paidQty) || 0) + (Number(item.bonusQty) || 0))
      )
    };
  }

  function getReturnsTotal(category) {
    return sum(
      currentReturns.filter(item => item.category === category),
      item => item.amount
    );
  }

  function getPaymentsTotal() {
    return sum(currentPayments, payment => payment.amount);
  }

  function getDiscountsTotal() {
    return sum(currentPayments, payment =>
      payment.totalDiscount ??
      (
        (Number(payment.medicineDiscount) || 0) +
        (Number(payment.generalDiscount) || 0)
      )
    );
  }

  /* =====================================
     Summary cards
  ===================================== */

  function updateSummary() {
    const allItems = currentInvoices.flatMap(
      invoice => Array.isArray(invoice.items) ? invoice.items : []
    );

    const setText = (id, value) => {
      const element = $(id);
      if (element) element.textContent = value;
    };

    setText("reportMedicine", money(getCategoryTotal("medicine")));
    setText("reportGeneral", money(getCategoryTotal("general")));
    setText("reportInvoiceCount", quantity(currentInvoices.length));
    setText("reportItemCount", quantity(allItems.length));
    setText("reportReturns", money(sum(currentReturns, item => item.amount)));
    setText("reportBonus", quantity(sum(allItems, item => item.bonusQty)));
    setText("reportPayments", money(getPaymentsTotal()));
    setText("reportDiscounts", money(getDiscountsTotal()));
  }

  /* =====================================
     Monthly invoice table
  ===================================== */

  function renderInvoiceReport() {
    const tbody = $("reportInvoicesBody");
    if (!tbody) return;

    tbody.replaceChildren();

    const sorted = [...currentInvoices].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );

    if (!sorted.length) {
      createEmptyRow(tbody, 6, "لا توجد فواتير في هذا الشهر");
      return;
    }

    sorted.forEach(invoice => {
      const row = document.createElement("tr");

      createCell(formatDate(invoice.date), row);
      createCell(invoice.invoiceNumber || "—", row);
      createCell(categoryName(invoice.category), row);
      createCell(quantity(invoice.itemCount ?? invoice.items?.length ?? 0), row);
      createCell(money(invoice.total), row);

      const detailsCell = createCell("", row);
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = "التفاصيل";
      button.className = "secondary-button";
      button.dataset.invoiceDetails = String(invoice.id);

      detailsCell.appendChild(button);
      tbody.appendChild(row);
    });
  }

  /* =====================================
     Monthly item register
  ===================================== */

  function renderItemReport() {
    const tbody = $("reportItemsBody");
    if (!tbody) return;

    tbody.replaceChildren();

    const rows = [];

    currentInvoices.forEach(invoice => {
      (Array.isArray(invoice.items) ? invoice.items : []).forEach(item => {
        rows.push({
          name: item.name || "بدون اسم",
          category: invoice.category,
          paidQty: Number(item.paidQty) || 0,
          bonusQty: Number(item.bonusQty) || 0,
          totalQty: Number(
            item.totalQty ??
            ((Number(item.paidQty) || 0) + (Number(item.bonusQty) || 0))
          ),
          itemTotal: Number(item.itemTotal ?? item.lineTotal) || 0
        });
      });
    });

    if (!rows.length) {
      createEmptyRow(tbody, 6, "لا توجد بيانات أصناف");
      return;
    }

    rows.sort((a, b) => a.name.localeCompare(b.name, "ar"));

    rows.forEach(item => {
      const row = document.createElement("tr");

      createCell(item.name, row);
      createCell(categoryName(item.category), row);
      createCell(quantity(item.paidQty), row);
      createCell(quantity(item.bonusQty), row);
      createCell(quantity(item.totalQty), row);
      createCell(money(item.itemTotal), row);

      tbody.appendChild(row);
    });
  }

  /* =====================================
     Most purchased items
  ===================================== */

  function renderTopItems() {
    const tbody = $("reportTopItemsBody");
    if (!tbody) return;

    tbody.replaceChildren();

    const stats = new Map();

    currentInvoices.forEach(invoice => {
      (Array.isArray(invoice.items) ? invoice.items : []).forEach(item => {
        const name = String(item.name || "بدون اسم").trim();
        const key = `${invoice.category}::${name.toLocaleLowerCase()}`;

        if (!stats.has(key)) {
          stats.set(key, {
            name,
            category: invoice.category,
            totalQty: 0,
            purchases: 0,
            totalValue: 0
          });
        }

        const entry = stats.get(key);

        entry.totalQty += Number(
          item.totalQty ??
          ((Number(item.paidQty) || 0) + (Number(item.bonusQty) || 0))
        ) || 0;

        entry.purchases += 1;
        entry.totalValue += Number(item.itemTotal ?? item.lineTotal) || 0;
      });
    });

    const sorted = [...stats.values()].sort((a, b) =>
      b.totalQty - a.totalQty ||
      b.totalValue - a.totalValue
    );

    if (!sorted.length) {
      createEmptyRow(tbody, 4, "لا توجد بيانات أصناف");
      return;
    }

    sorted.forEach(item => {
      const row = document.createElement("tr");

      createCell(`${item.name} (${categoryName(item.category)})`, row);
      createCell(quantity(item.totalQty), row);
      createCell(quantity(item.purchases), row);
      createCell(money(item.totalValue), row);

      tbody.appendChild(row);
    });
  }

  /* =====================================
     Invoice details
  ===================================== */

  function showInvoiceDetails(invoice) {
    if (!invoice) return;

    const items = Array.isArray(invoice.items) ? invoice.items : [];

    const lines = [
      `رقم الفاتورة: ${invoice.invoiceNumber || "—"}`,
      `التاريخ: ${formatDate(invoice.date)}`,
      `الفئة: ${categoryName(invoice.category)}`,
      "",
      "الأصناف:"
    ];

    items.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.name || "بدون اسم"}`,
        `مدفوع: ${quantity(item.paidQty)}`,
        `بونص: ${quantity(item.bonusQty)}`,
        `إجمالي القطع: ${quantity(item.totalQty)}`,
        `سعر الوحدة: ${money(item.unitPrice)}`,
        `قيمة الصنف: ${money(item.itemTotal ?? item.lineTotal)}`,
        `التكلفة الفعلية للوحدة: ${money(item.actualUnitCost ?? item.effectiveUnitCost)}`,
        ""
      );
    });

    lines.push(`إجمالي الفاتورة: ${money(invoice.total)}`);

    if (invoice.notes) lines.push("", `ملاحظات: ${invoice.notes}`);

    alert(lines.join("\n"));
  }

  /* =====================================
     Monthly report loading
  ===================================== */

  async function loadReport() {
    const month = getMonth();

    if (!/^\d{4}-\d{2}$/.test(month)) {
      alert("حدد شهراً صحيحاً");
      return;
    }

    try {
      const [invoices, returns, payments] = await Promise.all([
        dbGetByIndex(DB_STORES.INVOICES, "month", month),
        dbGetByIndex(DB_STORES.RETURNS, "month", month),
        dbGetByIndex(DB_STORES.PAYMENTS, "month", month)
      ]);

      currentInvoices = Array.isArray(invoices) ? invoices : [];
      currentReturns = Array.isArray(returns) ? returns : [];
      currentPayments = Array.isArray(payments) ? payments : [];

      updateSummary();
      renderInvoiceReport();
      renderItemReport();
      renderTopItems();

      return {
        month,
        invoices: currentInvoices,
        returns: currentReturns,
        payments: currentPayments
      };

    } catch (error) {
      console.error("Report loading error:", error);
      alert("تعذر تحميل التقرير");
    }
  }

  /* =====================================
     Archive helpers
  ===================================== */

  function paymentDetails(payment) {
    const lines = [
      `مبلغ التسديد: ${money(payment.amount)}`,
      `رصيد الأدوية قبل العملية: ${money(payment.medicineBalanceBefore)}`,
      `رصيد المواد العامة قبل العملية: ${money(payment.generalBalanceBefore)}`,
      `خصم الأدوية (${Number(payment.medicineDiscountRate) || 0}%): ${money(payment.medicineDiscount)}`,
      `خصم المواد العامة (${Number(payment.generalDiscountRate) || 0}%): ${money(payment.generalDiscount)}`,
      `إجمالي الخصم: ${money(payment.totalDiscount)}`,
      `المستحق بعد الخصم: ${money(payment.totalDue)}`,
      `المتبقي بعد التسديد: ${money(payment.remainingAfterPayment)}`,
      `المدفوع من رصيد الأدوية: ${money(payment.medicinePaid)}`,
      `المدفوع من رصيد المواد العامة: ${money(payment.generalPaid)}`
    ];

    if (payment.notes) lines.push("", `ملاحظات: ${payment.notes}`);

    return lines.join("\n");
  }

  function showPaymentDetails(payment) {
    alert(paymentDetails(payment));
  }

  function showReturnDetails(item) {
    const lines = [
      `رقم المردود: ${item.returnNumber || "—"}`,
      `التاريخ: ${formatDate(item.date)}`,
      `الفئة: ${categoryName(item.category)}`,
      `رقم الفاتورة المرتبطة: ${item.invoiceNumber || "غير محدد"}`,
      `قيمة المردود: ${money(item.amount)}`
    ];

    if (item.notes) lines.push("", `ملاحظات: ${item.notes}`);

    alert(lines.join("\n"));
  }

  function createArchiveRecord(date, number, type, category, amount, kind, id, detail) {
    return {
      date: date || "",
      number: number || "—",
      type,
      category: categoryName(category),
      amount: Number(amount) || 0,
      kind,
      id,
      detail
    };
  }

  async function loadArchive(searchText = "") {
    const tbody = $("archiveBody");
    if (!tbody) return;

    tbody.replaceChildren();

    try {
      const [invoices, returns, payments] = await Promise.all([
        dbGetAll(DB_STORES.INVOICES),
        dbGetAll(DB_STORES.RETURNS),
        dbGetAll(DB_STORES.PAYMENTS)
      ]);

      const records = [];

      invoices.forEach(invoice => {
        records.push(createArchiveRecord(
          invoice.date,
          invoice.invoiceNumber,
          "فاتورة",
          invoice.category,
          invoice.total,
          "invoice",
          invoice.id,
          invoice
        ));
      });

      returns.forEach(item => {
        records.push(createArchiveRecord(
          item.date,
          item.returnNumber,
          "مردود",
          item.category,
          item.amount,
          "return",
          item.id,
          item
        ));
      });

      payments.forEach(payment => {
        records.push(createArchiveRecord(
          payment.date,
          payment.id ? `تسديد #${payment.id}` : "تسديد",
          "تسديد",
          null,
          payment.amount,
          "payment",
          payment.id,
          payment
        ));
      });

      const query = String(searchText || "").trim().toLocaleLowerCase();

      const filtered = records
        .filter(record => {
          if (!query) return true;

          const detailText = record.kind === "invoice"
            ? (record.detail.items || []).map(item => item.name || "").join(" ")
            : record.kind === "payment"
              ? paymentDetails(record.detail)
              : [
                  record.detail.returnNumber,
                  record.detail.invoiceNumber,
                  record.detail.notes
                ].filter(Boolean).join(" ");

          return [
            record.date,
            record.number,
            record.type,
            record.category,
            detailText
          ].join(" ").toLocaleLowerCase().includes(query);
        })
        .sort((a, b) =>
          String(b.date).localeCompare(String(a.date))
        );

      if (!filtered.length) {
        createEmptyRow(tbody, 6, "لا توجد عمليات مطابقة");
        return;
      }

      filtered.forEach(record => {
        const row = document.createElement("tr");

        createCell(formatDate(record.date), row);
        createCell(record.number, row);
        createCell(record.type, row);
        createCell(record.category, row);
        createCell(money(record.amount), row);

        const detailsCell = createCell("", row);
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = "التفاصيل";
        button.className = "secondary-button";
        button.dataset.archiveKind = record.kind;
        button.dataset.archiveId = String(record.id);

        detailsCell.appendChild(button);
        tbody.appendChild(row);
      });

    } catch (error) {
      console.error("Archive loading error:", error);
      alert("تعذر تحميل الأرشيف");
    }
  }

  async function showArchiveDetails(kind, id) {
    try {
      let record;

      if (kind === "invoice") {
        record = await dbGet(DB_STORES.INVOICES, Number(id));
        showInvoiceDetails(record);
        return;
      }

      if (kind === "return") {
        record = await dbGet(DB_STORES.RETURNS, Number(id));
        if (record) showReturnDetails(record);
        return;
      }

      if (kind === "payment") {
        record = await dbGet(DB_STORES.PAYMENTS, Number(id));
        if (record) showPaymentDetails(record);
      }

    } catch (error) {
      console.error("Archive details error:", error);
      alert("تعذر عرض تفاصيل العملية");
    }
  }

  /* =====================================
     CSV export
  ===================================== */

  function csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCSV() {
    if (
      currentInvoices.length === 0 &&
      currentReturns.length === 0 &&
      currentPayments.length === 0
    ) {
      alert("لا توجد بيانات لتصديرها");
      return;
    }

    const rows = [[
      "نوع السجل",
      "التاريخ",
      "الرقم",
      "الفئة",
      "اسم الصنف",
      "الكمية المدفوعة",
      "البونص",
      "إجمالي الكمية",
      "سعر الوحدة",
      "قيمة الصنف أو العملية",
      "التكلفة الفعلية للوحدة",
      "ملاحظات"
    ]];

    currentInvoices.forEach(invoice => {
      (invoice.items || []).forEach(item => {
        rows.push([
          "فاتورة",
          invoice.date,
          invoice.invoiceNumber || "",
          categoryName(invoice.category),
          item.name,
          item.paidQty,
          item.bonusQty,
          item.totalQty,
          item.unitPrice,
          item.itemTotal ?? item.lineTotal,
          item.actualUnitCost ?? item.effectiveUnitCost,
          invoice.notes || ""
        ]);
      });
    });

    currentReturns.forEach(item => {
      rows.push([
        "مردود",
        item.date,
        item.returnNumber || "",
        categoryName(item.category),
        "",
        "",
        "",
        "",
        "",
        item.amount,
        "",
        item.notes || ""
      ]);
    });

    currentPayments.forEach(payment => {
      rows.push([
        "تسديد",
        payment.date,
        payment.id || "",
        "الفئتان",
        "",
        "",
        "",
        "",
        "",
        payment.amount,
        "",
        [
          `خصم الأدوية: ${payment.medicineDiscount || 0}`,
          `خصم المواد العامة: ${payment.generalDiscount || 0}`,
          payment.notes || ""
        ].join(" | ")
      ]);
    });

    const csv = "\uFEFF" + rows
      .map(row => row.map(csvEscape).join(","))
      .join("\r\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `pharmacy-report-${getMonth()}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* =====================================
     Event bindings
  ===================================== */

  function initialize() {
    const monthInput = $("reportMonth");

    if (monthInput && !monthInput.value) {
      monthInput.value = getMonth();
    }

    $("loadReportBtn")?.addEventListener("click", loadReport);
    $("exportCsvBtn")?.addEventListener("click", exportCSV);

    $("reportInvoicesBody")?.addEventListener("click", event => {
      const button = event.target.closest("[data-invoice-details]");
      if (!button) return;

      const invoice = currentInvoices.find(
        item => Number(item.id) === Number(button.dataset.invoiceDetails)
      );

      showInvoiceDetails(invoice);
    });

    $("archiveBody")?.addEventListener("click", event => {
      const button = event.target.closest("[data-archive-kind]");
      if (!button) return;

      showArchiveDetails(
        button.dataset.archiveKind,
        button.dataset.archiveId
      );
    });

    $("archiveSearch")?.addEventListener("input", event => {
      loadArchive(event.target.value);
    });
  }

  return {
    initialize,
    loadReport,
    loadArchive,
    exportCSV,
    getCategoryTotal,
    getCategoryItems,
    getItemStats,
    getReturnsTotal,
    getCurrentInvoices: () => currentInvoices,
    getCurrentReturns: () => currentReturns,
    getCurrentPayments: () => currentPayments
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  PMReports.initialize();
});
