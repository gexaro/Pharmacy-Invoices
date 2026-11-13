
"use strict";

/* =====================================
   Reports & Archive
   Pharmacy Purchase Manager
===================================== */

const PMReports = (() => {

  let currentInvoices = [];
  let currentReturns = [];

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
    return category === "medicine" ? "أدوية" : "قديم ومواد عامة";
  }

  function formatDate(value) {
    if (!value) return "—";

    const parts = String(value).split("-");

    if (parts.length !== 3) return value;

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function createCell(value, parent, className = "") {
    const cell = document.createElement("td");
    cell.textContent = value;

    if (className) {
      cell.className = className;
    }

    parent.appendChild(cell);
    return cell;
  }

  function getMonth() {
    const input = $("reportMonth");

    if (input?.value) {
      return input.value;
    }

    return dbGetCurrentMonth();
  }

  function getMonthInvoices(month) {
    return dbGetByIndex(
      DB_STORES.INVOICES,
      "month",
      month
    );
  }

  function getMonthReturns(month) {
    return dbGetByIndex(
      DB_STORES.RETURNS,
      "month",
      month
    );
  }

  function sum(values, callback) {
    return values.reduce((total, item) => {
      return total + (Number(callback(item)) || 0);
    }, 0);
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
    const categoryItems = getCategoryItems(category);

    return {
      count: categoryItems.length,

      paid: sum(categoryItems, item => item.paidQty),

      bonus: sum(categoryItems, item => item.bonusQty),

      received: sum(categoryItems, item => {
        return item.totalQty ??
          ((Number(item.paidQty) || 0) +
           (Number(item.bonusQty) || 0));
      })
    };
  }

  function getReturnsTotal(category) {
    return sum(
      currentReturns.filter(item => item.category === category),
      item => item.amount
    );
  }

  /* =====================================
     Report summary
  ===================================== */

  function updateSummary() {
    const medicineTotal = getCategoryTotal("medicine");
    const generalTotal = getCategoryTotal("general");

    const allItems = currentInvoices.flatMap(
      invoice => Array.isArray(invoice.items) ? invoice.items : []
    );

    const invoiceCount = currentInvoices.length;
    const itemCount = allItems.length;

    const returnsTotal = sum(
      currentReturns,
      item => item.amount
    );

    const bonusTotal = sum(
      allItems,
      item => item.bonusQty
    );

    if ($("reportMedicine")) {
      $("reportMedicine").textContent = money(medicineTotal);
    }

    if ($("reportGeneral")) {
      $("reportGeneral").textContent = money(generalTotal);
    }

    if ($("reportInvoiceCount")) {
      $("reportInvoiceCount").textContent = quantity(invoiceCount);
    }

    if ($("reportItemCount")) {
      $("reportItemCount").textContent = quantity(itemCount);
    }

    if ($("reportReturns")) {
      $("reportReturns").textContent = money(returnsTotal);
    }

    if ($("reportBonus")) {
      $("reportBonus").textContent = quantity(bonusTotal);
    }
  }

  /* =====================================
     Invoice report table
  ===================================== */

  function renderInvoiceReport() {
    const tbody = $("reportInvoicesBody");

    if (!tbody) return;

    tbody.replaceChildren();

    const sorted = [...currentInvoices].sort((a, b) => {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });

    if (sorted.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 6;
      cell.textContent = "لا توجد فواتير في هذا الشهر";
      cell.className = "empty-cell";

      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    sorted.forEach(invoice => {
      const row = document.createElement("tr");

      createCell(formatDate(invoice.date), row);
      createCell(invoice.invoiceNumber || "—", row);
      createCell(categoryName(invoice.category), row);
      createCell(quantity(invoice.itemCount), row);
      createCell(money(invoice.total), row);

      const detailsCell = createCell("", row);

      const button = document.createElement("button");

      button.type = "button";
      button.textContent = "التفاصيل";
      button.className = "secondary-btn";
      button.dataset.invoiceDetails = String(invoice.id);

      detailsCell.appendChild(button);

      tbody.appendChild(row);
    });
  }

  /* =====================================
     Invoice details
  ===================================== */

  function showInvoiceDetails(invoiceId) {
    const invoice = currentInvoices.find(
      item => Number(item.id) === Number(invoiceId)
    );

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
        `${index + 1}. ${item.name}`,
        `مدفوع: ${quantity(item.paidQty)}`,
        `بونص: ${quantity(item.bonusQty)}`,
        `الإجمالي: ${quantity(item.totalQty)}`,
        `سعر الوحدة: ${money(item.unitPrice)}`,
        `قيمة الصنف: ${money(item.itemTotal ?? item.lineTotal)}`,
        `التكلفة الفعلية للوحدة: ${money(item.actualUnitCost ?? item.effectiveUnitCost)}`,
        ""
      );
    });

    lines.push(`إجمالي الفاتورة: ${money(invoice.total)}`);

    if (invoice.notes) {
      lines.push("", `ملاحظات: ${invoice.notes}`);
    }

    alert(lines.join("\n"));
  }

  /* =====================================
     Load monthly report
  ===================================== */

  async function loadReport() {
    const month = getMonth();

    if (!/^\d{4}-\d{2}$/.test(month)) {
      alert("حدد شهراً صحيحاً");
      return;
    }

    try {
      const [invoices, returns] = await Promise.all([
        getMonthInvoices(month),
        getMonthReturns(month)
      ]);

      currentInvoices = Array.isArray(invoices) ? invoices : [];
      currentReturns = Array.isArray(returns) ? returns : [];

      updateSummary();
      renderInvoiceReport();

      return {
        month,
        invoices: currentInvoices,
        returns: currentReturns
      };

    } catch (error) {
      console.error("Report loading error:", error);
      alert("تعذر تحميل التقرير");
    }
  }

  /* =====================================
     Archive
  ===================================== */

  async function loadArchive(searchText = "") {
    const tbody = $("archiveBody");

    if (!tbody) return;

    tbody.replaceChildren();

    try {
      const invoices = await dbGetAll(DB_STORES.INVOICES);

      const query = String(searchText).trim().toLowerCase();

      const filtered = invoices
        .filter(invoice => {
          if (!query) return true;

          const invoiceNumber = String(
            invoice.invoiceNumber || ""
          ).toLowerCase();

          const category = categoryName(invoice.category).toLowerCase();

          const itemNames = (invoice.items || [])
            .map(item => String(item.name || "").toLowerCase())
            .join(" ");

          return (
            invoiceNumber.includes(query) ||
            category.includes(query) ||
            itemNames.includes(query) ||
            String(invoice.date || "").includes(query)
          );
        })
        .sort((a, b) => {
          return String(b.date || "").localeCompare(String(a.date || ""));
        });

      if (filtered.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 5;
        cell.textContent = "لا توجد نتائج";
        cell.className = "empty-cell";

        row.appendChild(cell);
        tbody.appendChild(row);
        return;
      }

      filtered.forEach(invoice => {
        const row = document.createElement("tr");

        createCell(formatDate(invoice.date), row);
        createCell(invoice.invoiceNumber || "—", row);
        createCell(categoryName(invoice.category), row);
        createCell(money(invoice.total), row);

        const detailsCell = createCell("", row);
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = "التفاصيل";
        button.className = "secondary-btn";
        button.dataset.archiveDetails = String(invoice.id);

        detailsCell.appendChild(button);

        tbody.appendChild(row);
      });

    } catch (error) {
      console.error("Archive loading error:", error);
      alert("تعذر تحميل الأرشيف");
    }
  }

  async function showArchiveInvoice(invoiceId) {
    try {
      const invoice = await dbGet(
        DB_STORES.INVOICES,
        Number(invoiceId)
      );

      if (!invoice) return;

      const lines = [
        `رقم الفاتورة: ${invoice.invoiceNumber || "—"}`,
        `التاريخ: ${formatDate(invoice.date)}`,
        `الفئة: ${categoryName(invoice.category)}`,
        ""
      ];

      (invoice.items || []).forEach((item, index) => {
        lines.push(
          `${index + 1}. ${item.name}`,
          `مدفوع: ${quantity(item.paidQty)}`,
          `بونص: ${quantity(item.bonusQty)}`,
          `الإجمالي: ${quantity(item.totalQty)}`,
          `السعر: ${money(item.unitPrice)}`,
          `قيمة الصنف: ${money(item.itemTotal ?? item.lineTotal)}`,
          ""
        );
      });

      lines.push(`الإجمالي: ${money(invoice.total)}`);

      if (invoice.notes) {
        lines.push("", `ملاحظات: ${invoice.notes}`);
      }

      alert(lines.join("\n"));

    } catch (error) {
      console.error("Archive details error:", error);
      alert("تعذر عرض تفاصيل الفاتورة");
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
    if (currentInvoices.length === 0) {
      alert("لا توجد بيانات لتصديرها");
      return;
    }

    const rows = [];

    rows.push([
      "التاريخ",
      "رقم الفاتورة",
      "الفئة",
      "اسم الصنف",
      "الكمية المدفوعة",
      "البونص",
      "إجمالي الكمية",
      "سعر الوحدة",
      "قيمة الصنف",
      "التكلفة الفعلية للوحدة"
    ]);

    currentInvoices.forEach(invoice => {
      (invoice.items || []).forEach(item => {
        rows.push([
          invoice.date,
          invoice.invoiceNumber || "",
          categoryName(invoice.category),
          item.name,
          item.paidQty,
          item.bonusQty,
          item.totalQty,
          item.unitPrice,
          item.itemTotal ?? item.lineTotal,
          item.actualUnitCost ?? item.effectiveUnitCost
        ]);
      });
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

      showInvoiceDetails(Number(button.dataset.invoiceDetails));
    });

    $("archiveBody")?.addEventListener("click", event => {
      const button = event.target.closest("[data-archive-details]");

      if (!button) return;

      showArchiveInvoice(Number(button.dataset.archiveDetails));
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
    getCurrentReturns: () => currentReturns
  };

})();

document.addEventListener("DOMContentLoaded", () => {
  PMReports.initialize();
});
