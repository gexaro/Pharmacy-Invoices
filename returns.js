
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

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

  async function getInvoices() {
    return window.PharmacyDB.getAll('invoices');
  }

  async function getReturns() {
    return window.PharmacyDB.getAll('returns');
  }

  function categoryName(category) {
    return category === 'medicine' ? 'الأدوية' : 'المواد العامة';
  }

  async function calculateCapacity(category, invoiceId) {
    const [invoices, returns] = await Promise.all([
      getInvoices(),
      getReturns()
    ]);

    const matchingInvoices = invoices.filter(invoice =>
      invoice.category === category &&
      (!invoiceId || String(invoice.id) === String(invoiceId))
    );

    const purchased = matchingInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.total || 0), 0
    );

    const invoiceIds = new Set(matchingInvoices.map(invoice => invoice.id));

    const returned = returns
      .filter(item =>
        item.category === category &&
        (!invoiceId || String(item.invoiceId) === String(invoiceId)) &&
        (!item.invoiceId || invoiceIds.has(item.invoiceId))
      )
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return Math.max(0, Math.round((purchased - returned) * 100) / 100);
  }

  async function renderInvoices() {
    const select = $('returnInvoice');
    if (!select) return;

    const previous = select.value;
    const invoices = await getInvoices();

    select.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'كل فواتير الفئة';
    select.append(placeholder);

    const category = $('returnType')?.value;

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

      info.textContent =
        'الحد المتاح للمردود في ' + categoryName(category) +
        ': ' + money(capacity) + ' د.ع';
    } catch (error) {
      info.textContent = error.message || 'تعذر حساب الحد المتاح.';
    }
  }

  async function saveReturn() {
    const category = $('returnType')?.value;
    const date = $('returnDate')?.value;
    const amount = Number($('returnAmount')?.value);
    const invoiceValue = $('returnInvoice')?.value || '';
    const invoiceId = invoiceValue ? Number(invoiceValue) : null;

    if (!['medicine', 'general'].includes(category)) {
      toast('اختر فئة المردود.');
      return;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast('اختر تاريخ المردود.');
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast('أدخل قيمة مردود صحيحة أكبر من صفر.');
      return;
    }

    try {
      const capacity = await calculateCapacity(category, invoiceId);

      if (amount > capacity + 0.001) {
        toast(
          'قيمة المردود تتجاوز الحد المتاح (' +
          money(capacity) + ' د.ع).'
        );
        return;
      }

      const record = {
        category,
        date,
        month: date.slice(0, 7),
        invoiceId,
        amount: Math.round(amount * 100) / 100,
        number: String($('returnNumber')?.value || '').trim(),
        notes: String($('returnNotes')?.value || '').trim(),
        createdAt: new Date().toISOString()
      };

      const button = $('saveReturnBtn');
      if (button) button.disabled = true;

      await window.PharmacyDB.add('returns', record);

      $('returnAmount').value = '';
      $('returnNumber').value = '';
      $('returnNotes').value = '';

      toast('تم تسجيل المردود بنجاح.');

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'return' }
        })
      );

      await updateCapacity();
    } catch (error) {
      toast(error.message || 'تعذر تسجيل المردود.');
    } finally {
      const button = $('saveReturnBtn');
      if (button) button.disabled = false;
    }
  }

  function init() {
    if (!$('returnDate')) return;

    if (!$('returnDate').value) {
      $('returnDate').value = new Date().toISOString().slice(0, 10);
    }

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
