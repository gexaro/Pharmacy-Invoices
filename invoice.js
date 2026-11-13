
"use strict";

/* =====================================
   Invoice Manager
   Pharmacy Purchase Manager
===================================== */

const PMInvoice = (() => {

  let items = [];
  let saving = false;

  const $ = (id) => document.getElementById(id);

  /* =====================================
     Number helpers
  ===================================== */

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundMoney(value) {
    return Math.round((numberValue(value) + Number.EPSILON) * 100) / 100;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2
    }).format(numberValue(value));
  }

  function formatQuantity(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0
    }).format(numberValue(value));
  }

  function todayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function notify(message) {
    if (typeof window.showToast === "function") {
      window.showToast(message);
      return;
    }

    const toast = $("toast");

    if (toast) {
      toast.textContent = message;
      toast.classList.add("show");

      clearTimeout(notify.timer);

      notify.timer = setTimeout(() => {
        toast.classList.remove("show");
      }, 2600);

      return;
    }

    alert(message);
  }

  /* =====================================
     Calculate item
  ===================================== */

  function calculateItem(item) {
    const paidQty = numberValue(item.paidQty);
    const bonusQty = numberValue(item.bonusQty);
    const unitPrice = numberValue(item.unitPrice);

    const totalQty = paidQty + bonusQty;

    // Only paid quantity is charged.
    const itemTotal = roundMoney(paidQty * unitPrice);

    // Actual cost after adding free bonus units.
    const actualUnitCost = totalQty > 0
      ? roundMoney(itemTotal / totalQty)
      : 0;

    return {
      ...item,
      paidQty,
      bonusQty,
      totalQty,
      unitPrice,
      itemTotal,
      actualUnitCost
    };
  }

  /* =====================================
     Invoice total
  ===================================== */

  function getInvoiceTotal() {
    return roundMoney(
      items.reduce((sum, item) => {
        return sum + calculateItem(item).itemTotal;
      }, 0)
    );
  }

  function getTotalBonus() {
    return items.reduce((sum, item) => {
      return sum + numberValue(item.bonusQty);
    }, 0);
  }

  /* =====================================
     Add item
  ===================================== */

  function addItem() {
    const name = $("itemName")?.value.trim() || "";
    const paidQty = numberValue($("itemPaidQty")?.value);
    const bonusQty = numberValue($("itemBonusQty")?.value);
    const unitPrice = numberValue($("itemUnitPrice")?.value);

    if (!name) {
      notify("أدخل اسم الصنف أولاً");
      $("itemName")?.focus();
      return;
    }

    if (
      !Number.isInteger(paidQty) ||
      !Number.isInteger(bonusQty) ||
      paidQty < 0 ||
      bonusQty < 0
    ) {
      notify("الكميات يجب أن تكون أعداداً صحيحة وغير سالبة");
      return;
    }

    if (paidQty + bonusQty <= 0) {
      notify("أدخل كمية مدفوعة أو كمية بونص");
      return;
    }

    if (unitPrice < 0 || !Number.isFinite(unitPrice)) {
      notify("سعر الوحدة غير صالح");
      return;
    }

    const item = calculateItem({
      name,
      paidQty,
      bonusQty,
      unitPrice
    });

    items.push(item);

    renderItems();

    $("itemName").value = "";
    $("itemPaidQty").value = "";
    $("itemBonusQty").value = "0";
    $("itemUnitPrice").value = "";

    $("itemName").focus();
  }

  /* =====================================
     Remove item
  ===================================== */

  function removeItem(index) {
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return;
    }

    items.splice(index, 1);
    renderItems();
  }

  /* =====================================
     Render items table
  ===================================== */

  function renderItems() {
    const tbody = $("invoiceItemsBody");

    if (!tbody) return;

    tbody.replaceChildren();

    if (items.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 7;
      cell.className = "empty-cell";
      cell.textContent = "لم تتم إضافة أصناف بعد";

      row.appendChild(cell);
      tbody.appendChild(row);

      updateTotal();
      return;
    }

    items.forEach((rawItem, index) => {
      const item = calculateItem(rawItem);
      const row = document.createElement("tr");

      const values = [
        item.name,
        formatQuantity(item.paidQty),
        formatQuantity(item.bonusQty),
        formatQuantity(item.totalQty),
        formatMoney(item.unitPrice),
        formatMoney(item.itemTotal)
      ];

      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      const actionCell = document.createElement("td");
      const deleteButton = document.createElement("button");

      deleteButton.type = "button";
      deleteButton.textContent = "×";
      deleteButton.setAttribute("aria-label", "حذف الصنف");
      deleteButton.dataset.removeItem = String(index);

      deleteButton.style.cssText = [
        "width:30px",
        "height:30px",
        "border:0",
        "border-radius:9px",
        "background:rgba(198,92,87,.12)",
        "color:var(--danger)",
        "font-size:19px",
        "font-weight:700"
      ].join(";");

      actionCell.appendChild(deleteButton);
      row.appendChild(actionCell);

      tbody.appendChild(row);
    });

    updateTotal();
  }

  /* =====================================
     Update invoice total
  ===================================== */

  function updateTotal() {
    const totalElement = $("invoiceTotal");

    if (totalElement) {
      totalElement.textContent = formatMoney(getInvoiceTotal()) + " د.ع";
    }
  }

  /* =====================================
     Save invoice
  ===================================== */

  async function saveInvoice() {
    if (saving) return;

    if (items.length === 0) {
      notify("أضف صنفاً واحداً على الأقل");
      return;
    }

    const invoiceDate = $("invoiceDate")?.value || "";
    const invoiceNumber = $("invoiceNumber")?.value.trim() || "";
    const category = $("invoiceType")?.value || "";
    const notes = $("invoiceNotes")?.value.trim() || "";

    if (!invoiceDate) {
      notify("حدد تاريخ الفاتورة");
      $("invoiceDate")?.focus();
      return;
    }

    if (!["medicine", "general"].includes(category)) {
      notify("نوع الفاتورة غير صالح");
      return;
    }

    const invoiceItems = items.map((item) => calculateItem(item));

    const total = roundMoney(
      invoiceItems.reduce((sum, item) => sum + item.itemTotal, 0)
    );

    const totalPaidQty = invoiceItems.reduce(
      (sum, item) => sum + item.paidQty,
      0
    );

    const totalBonusQty = invoiceItems.reduce(
      (sum, item) => sum + item.bonusQty,
      0
    );

    const totalReceivedQty = invoiceItems.reduce(
      (sum, item) => sum + item.totalQty,
      0
    );

    const invoice = {
      invoiceNumber,
      category,
      date: invoiceDate,
      month: invoiceDate.slice(0, 7),
      notes,

      items: invoiceItems,

      total,
      totalPaidQty,
      totalBonusQty,
      totalReceivedQty,

      itemCount: invoiceItems.length,

      createdAt: new Date().toISOString(),

      // Discounts are deliberately not stored here.
      discount: 0
    };

    const saveButton = $("saveInvoiceBtn");

    saving = true;

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "جارٍ الحفظ...";
    }

    try {
      const id = await dbAdd("invoices", invoice);

      invoice.id = id;

      items = [];
      renderItems();

      if ($("invoiceNumber")) $("invoiceNumber").value = "";
      if ($("invoiceNotes")) $("invoiceNotes").value = "";
      if ($("itemName")) $("itemName").value = "";
      if ($("itemPaidQty")) $("itemPaidQty").value = "";
      if ($("itemBonusQty")) $("itemBonusQty").value = "0";
      if ($("itemUnitPrice")) $("itemUnitPrice").value = "";

      if ($("invoiceDate")) {
        $("invoiceDate").value = todayString();
      }

      notify("تم حفظ الفاتورة بنجاح");

      window.dispatchEvent(
        new CustomEvent("pm:datachanged", {
          detail: {
            type: "invoice",
            id
          }
        })
      );

    } catch (error) {
      console.error("Invoice save error:", error);
      notify("تعذر حفظ الفاتورة: " + error.message);

    } finally {
      saving = false;

      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "حفظ الفاتورة";
      }
    }
  }

  /* =====================================
     Reset pending invoice
  ===================================== */

  function reset() {
    items = [];
    renderItems();
  }

  /* =====================================
     Initialize
  ===================================== */

  function initialize() {
    const dateInput = $("invoiceDate");

    if (dateInput && !dateInput.value) {
      dateInput.value = todayString();
    }

    const addButton = $("addItemBtn");
    const saveButton = $("saveInvoiceBtn");
    const tbody = $("invoiceItemsBody");

    addButton?.addEventListener("click", addItem);

    saveButton?.addEventListener("click", saveInvoice);

    tbody?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-item]");

      if (!button) return;

      const index = Number(button.dataset.removeItem);

      removeItem(index);
    });

    $("itemName")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        $("itemPaidQty")?.focus();
      }
    });

    $("itemUnitPrice")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addItem();
      }
    });

    renderItems();
  }

  return {
    initialize,
    addItem,
    removeItem,
    renderItems,
    saveInvoice,
    getInvoiceTotal,
    getTotalBonus,
    getItems: () => items.map((item) => calculateItem(item)),
    reset
  };

})();

document.addEventListener("DOMContentLoaded", () => {
  PMInvoice.initialize();
});
