
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  let items = [];

  const round = value =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  const money = value =>
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2
    }).format(Number(value) || 0);

  function toast(message) {
    if (window.PharmacyApp?.toast) {
      window.PharmacyApp.toast(message);
    } else {
      alert(message);
    }
  }

  function today() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function validDate(value) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return false;
    }

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function readItem(data) {
    const name = String(data.name || '').trim();
    const paidQty = Number(data.paidQty);
    const bonusQty = Number(data.bonusQty);
    const unitPrice = Number(data.unitPrice);

    if (!name) {
      throw new Error('أدخل اسم الصنف.');
    }

    if (
      !Number.isSafeInteger(paidQty) ||
      paidQty <= 0
    ) {
      throw new Error(
        'الكمية المدفوعة يجب أن تكون عدداً صحيحاً أكبر من صفر.'
      );
    }

    if (
      !Number.isSafeInteger(bonusQty) ||
      bonusQty < 0 ||
      paidQty + bonusQty > Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('كمية البونص غير صحيحة.');
    }

    if (
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      unitPrice > Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('سعر الوحدة غير صحيح.');
    }

    const itemTotal = round(paidQty * unitPrice);

    if (
      !Number.isFinite(itemTotal) ||
      !Number.isSafeInteger(Math.round(itemTotal * 100))
    ) {
      throw new Error('قيمة الصنف أكبر من النطاق المسموح.');
    }

    const receivedQty = paidQty + bonusQty;

    return {
      name,
      paidQty,
      bonusQty,
      receivedQty,
      unitPrice,
      itemTotal,
      effectiveUnitCost: receivedQty > 0
        ? itemTotal / receivedQty
        : 0
    };
  }

  function total() {
    return round(
      items.reduce((sum, item) => sum + item.itemTotal, 0)
    );
  }

  function render() {
    const list = $('invoiceItemsList');
    const count = $('invoiceItemCount');
    const totalElement = $('invoiceTotal');

    if (!list) return;

    list.replaceChildren();

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'لم تتم إضافة أصناف بعد';
      list.append(empty);
    }

    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'invoice-item';

      const head = document.createElement('div');
      head.className = 'invoice-item-head';

      const name = document.createElement('strong');
      name.textContent = item.name;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-item';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'حذف ' + item.name);

      remove.addEventListener('click', () => {
        items.splice(index, 1);
        render();
      });

      head.append(name, remove);

      const meta = document.createElement('div');
      meta.className = 'invoice-item-meta';

      const details = document.createElement('span');
      details.textContent =
        'مدفوع: ' + item.paidQty +
        ' · بونص: ' + item.bonusQty +
        ' · مستلم: ' + item.receivedQty;

      const price = document.createElement('span');
      price.textContent =
        money(item.unitPrice) + ' × ' + item.paidQty;

      const amount = document.createElement('strong');
      amount.textContent = money(item.itemTotal) + ' د.ع';

      meta.append(details, price, amount);
      card.append(head, meta);
      list.append(card);
    });

    if (count) {
      count.textContent = String(items.length);
    }

    if (totalElement) {
      totalElement.textContent = money(total()) + ' د.ع';
    }

    const saveButton = $('saveInvoiceBtn');

    if (saveButton) {
      saveButton.disabled = items.length === 0;
    }
  }

  function addMany(values) {
    if (!Array.isArray(values) || !values.length) {
      throw new Error('لا توجد أصناف لإضافتها.');
    }

    const prepared = values.map(readItem);

    items.push(...prepared);
    render();

    return prepared.length;
  }

  function addManualItem() {
    try {
      const item = readItem({
        name: $('itemName')?.value,
        paidQty: $('itemPaidQty')?.value,
        bonusQty: $('itemBonusQty')?.value || 0,
        unitPrice: $('itemUnitPrice')?.value
      });

      items.push(item);

      $('itemName').value = '';
      $('itemPaidQty').value = '';
      $('itemBonusQty').value = '0';
      $('itemUnitPrice').value = '';

      render();
      $('itemName')?.focus();

    } catch (error) {
      toast(error.message);
    }
  }

  function reset() {
    if (
      items.length &&
      !confirm('هل تريد تفريغ جميع أصناف الفاتورة؟')
    ) {
      return;
    }

    items = [];

    [
      'invoiceNumber',
      'invoiceNotes',
      'itemName',
      'itemPaidQty',
      'itemUnitPrice'
    ].forEach(id => {
      if ($(id)) $(id).value = '';
    });

    if ($('itemBonusQty')) {
      $('itemBonusQty').value = '0';
    }

    render();
  }

  async function save() {
    if (!items.length) {
      toast('أضف صنفاً واحداً على الأقل.');
      return;
    }

    const date = $('invoiceDate')?.value;
    const category = $('invoiceType')?.value;

    if (!validDate(date)) {
      toast('اختر تاريخ الفاتورة بصورة صحيحة.');
      return;
    }

    if (!['medicine', 'general'].includes(category)) {
      toast('اختر فئة الفاتورة بصورة صحيحة.');
      return;
    }

    const invoiceItems = items.map(item => ({ ...item }));

    const invoiceTotal = round(
      invoiceItems.reduce(
        (sum, item) => sum + item.itemTotal,
        0
      )
    );

    if (
      !Number.isFinite(invoiceTotal) ||
      invoiceTotal < 0
    ) {
      toast('إجمالي الفاتورة غير صالح.');
      return;
    }

    const invoice = {
      category,
      number: String(
        $('invoiceNumber')?.value || ''
      ).trim(),
      date,
      month: date.slice(0, 7),
      notes: String(
        $('invoiceNotes')?.value || ''
      ).trim(),
      items: invoiceItems,
      total: invoiceTotal,
      createdAt: new Date().toISOString()
    };

    const button = $('saveInvoiceBtn');

    if (button?.disabled) return;
    if (button) button.disabled = true;

    try {
      if (!window.PharmacyDB) {
        throw new Error('قاعدة البيانات غير جاهزة.');
      }

      await window.PharmacyDB.add('invoices', invoice);

      items = [];
      render();

      [
        'invoiceNumber',
        'invoiceNotes'
      ].forEach(id => {
        if ($(id)) $(id).value = '';
      });

      toast('تم حفظ الفاتورة بنجاح.');

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'invoice' }
        })
      );

    } catch (error) {
      toast(error.message || 'تعذر حفظ الفاتورة.');
    } finally {
      if (button) {
        button.disabled = items.length === 0;
      }
    }
  }

  function init() {
    $('addItemBtn')?.addEventListener(
      'click',
      addManualItem
    );

    $('saveInvoiceBtn')?.addEventListener(
      'click',
      save
    );

    $('resetInvoiceBtn')?.addEventListener(
      'click',
      reset
    );

    if ($('invoiceDate') && !$('invoiceDate').value) {
      $('invoiceDate').value = today();
    }

    if ($('itemBonusQty')) {
      $('itemBonusQty').value = '0';
    }

    render();
  }

  window.PharmacyInvoice = Object.freeze({
    init,
    addMany,
    getItems: () => items.map(item => ({ ...item })),
    getTotal: total,
    reset
  });

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
