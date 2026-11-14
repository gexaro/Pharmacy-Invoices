(function () {
  'use strict';

  const $ = id => document.getElementById(id);
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
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day;
  }

  function validAmount(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const rounded = round(amount);
    return Number.isFinite(rounded) &&
      Number.isSafeInteger(Math.round(rounded * 100))
      ? rounded
      : null;
  }

  async function calculateCapacity(category, invoiceId = null) {
    if (!['medicine', 'general'].includes(category)) {
      throw new Error('فئة المردود غير صحيحة.');
    }

    const [invoices, returns] = await Promise.all([
      window.PharmacyDB.getAll('invoices'),
      window.PharmacyDB.getAll('returns')
    ]);
    const categoryInvoices = invoices.filter(invoice => invoice.category === category);
    const categoryPurchased = round(categoryInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.total || 0), 0
    ));
    const categoryReturned = round(returns
      .filter(item => item.category === category)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const categoryCapacity = Math.max(0, round(categoryPurchased - categoryReturned));

    if (!invoiceId) return categoryCapacity;

    const selectedInvoice = categoryInvoices.find(
      invoice => String(invoice.id) === String(invoiceId)
    );
    if (!selectedInvoice) return 0;

    const invoiceReturned = round(returns
      .filter(item => item.category === category &&
        String(item.invoiceId) === String(invoiceId))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const invoiceCapacity = Math.max(
      0,
      round(Number(selectedInvoice.total || 0) - invoiceReturned)
    );
    return Math.min(invoiceCapacity, categoryCapacity);
  }

  async function renderInvoices() {
    const select = $('returnInvoice');
    if (!select) return;

    const previous = select.value;
    const invoices = await window.PharmacyDB.getAll('invoices');
    const category = $('returnType')?.value;
    select.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'كل فواتير الفئة';
    select.append(placeholder);

    invoices
      .filter(invoice => invoice.category === category)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .forEach(invoice => {
        const option = document.createElement('option');
        option.value = String(invoice.id);
        option.textContent =
          (invoice.number ? 'فاتورة ' + invoice.number : 'فاتورة #' + invoice.id) +
          ' — ' + invoice.date +
          ' — ' + money(invoice.total) + ' د.ع';
        select.append(option);
      });

    if ([...select.options].some(option => option.value === previous)) {
      select.value = previous;
    }
    await updateCapacity();
  }

  async function updateCapacity() {
    const info = $('returnCapacityInfo');
    if (!info) return;
    try {
      const category = $('returnType')?.value;
      const invoiceId = $('returnInvoice')?.value || null;
      const capacity = await calculateCapacity(category, invoiceId);
      info.textContent = 'الحد المتاح للمردود في ' +
        (category === 'medicine' ? 'الأدوية' : 'المواد العامة') +
        ': ' + money(capacity) + ' د.ع';
    } catch (error) {
      info.textContent = error.message || 'تعذر حساب الحد المتاح.';
    }
  }

  async function saveReturn() {
    const category = $('returnType')?.value;
    const date = $('returnDate')?.value;
    const amount = validAmount($('returnAmount')?.value);
    const invoiceValue = $('returnInvoice')?.value || '';
    const invoiceId = invoiceValue ? Number(invoiceValue) : null;

    if (!['medicine', 'general'].includes(category)) {
      toast('اختر فئة المردود.');
      return;
    }
    if (!validDate(date)) {
      toast('اختر تاريخ المردود بصورة صحيحة.');
      return;
    }
    if (amount === null) {
      toast('أدخل قيمة مردود صحيحة أكبر من صفر وبحد أقصى منزلتين عشريتين.');
      return;
    }
    if (invoiceId !== null && (!Number.isSafeInteger(invoiceId) || invoiceId <= 0)) {
      toast('الفاتورة المختارة غير صحيحة.');
      return;
    }

    const button = $('saveReturnBtn');
    if (button?.disabled) return;
    if (button) button.disabled = true;

    try {
      const record = {
        category,
        date,
        month: date.slice(0, 7),
        invoiceId,
        amount,
        number: String($('returnNumber')?.value || '').trim(),
        notes: String($('returnNotes')?.value || '').trim(),
        createdAt: new Date().toISOString()
      };

      // الفحص والحفظ يجريان بمعاملة واحدة، لمنع تجاوز الحد عند تعدد النوافذ.
      await window.PharmacyDB.addReturnWithinCapacity(record);

      if ($('returnAmount')) $('returnAmount').value = '';
      if ($('returnNumber')) $('returnNumber').value = '';
      if ($('returnNotes')) $('returnNotes').value = '';

      toast('تم تسجيل المردود بنجاح.');
      document.dispatchEvent(new CustomEvent('pharmacy:data-changed', {
        detail: { type: 'return' }
      }));
      await updateCapacity();
    } catch (error) {
      toast(error.message || 'تعذر تسجيل المردود.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function init() {
    if (!$('returnDate')) return;
    if (!$('returnDate').value) $('returnDate').value = today();
    $('returnType')?.addEventListener('change', renderInvoices);
    $('returnInvoice')?.addEventListener('change', updateCapacity);
    $('saveReturnBtn')?.addEventListener('click', saveReturn);
    renderInvoices();
  }

  window.PharmacyReturns = Object.freeze({
    init,
    calculateCapacity,
    refresh: renderInvoices
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
