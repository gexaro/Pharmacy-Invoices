
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  let currentReport = null;

  const money = value =>
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2
    }).format(Number(value) || 0);

  function localMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function toast(message) {
    if (window.PharmacyApp?.toast) {
      window.PharmacyApp.toast(message);
    } else {
      alert(message);
    }
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function emptyMessage(container, message) {
    if (!container) return;

    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = message;
    container.replaceChildren(p);
  }

  function makeRecordCard(title, details, amount) {
    const card = document.createElement('article');
    card.className = 'record-card';

    const head = document.createElement('div');
    head.className = 'record-card-head';

    const heading = document.createElement('strong');
    heading.textContent = title;

    const value = document.createElement('strong');
    value.className = 'record-value';
    value.textContent = amount;

    head.append(heading, value);

    const meta = document.createElement('div');
    meta.className = 'record-meta';
    meta.textContent = details;

    card.append(head, meta);
    return card;
  }

  function getMonth() {
    return $('reportMonth')?.value || '';
  }

  function inMonth(record, month) {
    return typeof record.date === 'string' &&
      record.date.startsWith(month);
  }

  async function loadReport() {
    const month = getMonth();

    if (!/^\d{4}-\d{2}$/.test(month)) {
      toast('اختر الشهر المطلوب أولاً.');
      return;
    }

    try {
      const [invoices, returns, payments] = await Promise.all([
        window.PharmacyDB.getAll('invoices'),
        window.PharmacyDB.getAll('returns'),
        window.PharmacyDB.getAll('payments')
      ]);

      const monthInvoices = invoices.filter(item => inMonth(item, month));
      const monthReturns = returns.filter(item => inMonth(item, month));
      const monthPayments = payments.filter(item => inMonth(item, month));

      const medicine = monthInvoices
        .filter(item => item.category === 'medicine')
        .reduce((sum, item) => sum + Number(item.total || 0), 0);

      const general = monthInvoices
        .filter(item => item.category === 'general')
        .reduce((sum, item) => sum + Number(item.total || 0), 0);

      const returnTotal = monthReturns.reduce(
        (sum, item) => sum + Number(item.amount || 0), 0
      );

      const paymentTotal = monthPayments.reduce(
        (sum, item) => sum + Number(item.amount || 0), 0
      );

      const discountTotal = monthPayments.reduce((sum, item) => {
        const discounts = item.discountAmounts || {};
        return sum +
          Number(discounts.medicine || 0) +
          Number(discounts.general || 0);
      }, 0);

      let itemCount = 0;
      let bonusTotal = 0;

      const itemMap = new Map();

      monthInvoices.forEach(invoice => {
        (Array.isArray(invoice.items) ? invoice.items : []).forEach(item => {
          itemCount++;

          const paid = Number(item.paidQty || 0);
          const bonus = Number(item.bonusQty || 0);
          const received = Number(item.receivedQty ?? (paid + bonus));
          const total = Number(item.itemTotal || 0);

          bonusTotal += bonus;

          const key = String(item.name || '').trim().toLocaleLowerCase();

          if (!key) return;

          if (!itemMap.has(key)) {
            itemMap.set(key, {
              name: String(item.name).trim(),
              paidQty: 0,
              bonusQty: 0,
              receivedQty: 0,
              total: 0,
              count: 0
            });
          }

          const entry = itemMap.get(key);
          entry.paidQty += paid;
          entry.bonusQty += bonus;
          entry.receivedQty += received;
          entry.total += total;
          entry.count++;
        });
      });

      const items = [...itemMap.values()].sort(
        (a, b) => b.total - a.total
      );

      currentReport = {
        month,
        invoices: monthInvoices,
        returns: monthReturns,
        payments: monthPayments,
        medicine,
        general,
        returnTotal,
        paymentTotal,
        discountTotal,
        itemCount,
        bonusTotal,
        items
      };

      setText('reportMedicine', money(medicine) + ' د.ع');
      setText('reportGeneral', money(general) + ' د.ع');
      setText('reportInvoiceCount', String(monthInvoices.length));
      setText('reportItemCount', String(itemCount));
      setText('reportReturns', money(returnTotal) + ' د.ع');
      setText('reportBonus', money(bonusTotal));
      setText('reportPayments', money(paymentTotal) + ' د.ع');
      setText('reportDiscounts', money(discountTotal) + ' د.ع');

      renderInvoices(monthInvoices);
      renderItems(items);

      toast('تم تحديث التقرير.');
    } catch (error) {
      toast(error.message || 'تعذر إنشاء التقرير.');
    }
  }

  function renderInvoices(invoices) {
    const list = $('reportInvoicesList');
    if (!list) return;

    list.replaceChildren();

    if (!invoices.length) {
      emptyMessage(list, 'لا توجد فواتير في هذا الشهر.');
      return;
    }

    [...invoices]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .forEach(invoice => {
        const category =
          invoice.category === 'medicine' ? 'الأدوية' : 'المواد العامة';

        const title = invoice.number
          ? 'فاتورة ' + invoice.number
          : 'فاتورة #' + invoice.id;

        const details =
          category + ' · ' + invoice.date +
          (invoice.notes ? ' · ' + invoice.notes : '');

        list.append(
          makeRecordCard(
            title,
            details,
            money(invoice.total) + ' د.ع'
          )
        );
      });
  }

  function renderItems(items) {
    const list = $('reportItemsList');
    const topList = $('reportTopItemsList');

    if (list) list.replaceChildren();
    if (topList) topList.replaceChildren();

    if (!items.length) {
      emptyMessage(list, 'لا توجد أصناف في هذا الشهر.');
      emptyMessage(topList, 'لا توجد بيانات.');
      return;
    }

    items.forEach(item => {
      const details =
        'مدفوع: ' + money(item.paidQty) +
        ' · بونص: ' + money(item.bonusQty) +
        ' · مستلم: ' + money(item.receivedQty) +
        ' · مرات الشراء: ' + item.count;

      list?.append(
        makeRecordCard(
          item.name,
          details,
          money(item.total) + ' د.ع'
        )
      );
    });

    items.slice(0, 10).forEach((item, index) => {
      topList?.append(
        makeRecordCard(
          (index + 1) + '. ' + item.name,
          'إجمالي المستلم: ' + money(item.receivedQty) +
          ' · مرات الشراء: ' + item.count,
          money(item.total) + ' د.ع'
        )
      );
    });
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    if (!currentReport || currentReport.month !== getMonth()) {
      toast('اعرض التقرير أولاً قبل التصدير.');
      return;
    }

    const report = currentReport;
    const rows = [];

    rows.push(['تقرير فواتير الصيدلية', report.month]);
    rows.push([]);
    rows.push(['البيان', 'القيمة']);
    rows.push(['مشتريات الأدوية', report.medicine]);
    rows.push(['مشتريات المواد العامة', report.general]);
    rows.push(['عدد الفواتير', report.invoices.length]);
    rows.push(['عدد الأصناف', report.itemCount]);
    rows.push(['كمية البونص', report.bonusTotal]);
    rows.push(['المردودات', report.returnTotal]);
    rows.push(['التسديدات', report.paymentTotal]);
    rows.push(['الخصومات', report.discountTotal]);

    rows.push([]);
    rows.push(['تفاصيل الفواتير']);
    rows.push([
      'التاريخ',
      'رقم الفاتورة',
      'الفئة',
      'عدد الأصناف',
      'الإجمالي',
      'الملاحظات'
    ]);

    report.invoices.forEach(invoice => {
      rows.push([
        invoice.date,
        invoice.number || '',
        invoice.category === 'medicine' ? 'الأدوية' : 'المواد العامة',
        Array.isArray(invoice.items) ? invoice.items.length : 0,
        invoice.total,
        invoice.notes || ''
      ]);
    });

    rows.push([]);
    rows.push(['تفاصيل المردودات']);
    rows.push(['التاريخ', 'رقم المردود', 'الفئة', 'القيمة', 'الملاحظات']);

    report.returns.forEach(item => {
      rows.push([
        item.date,
        item.number || '',
        item.category === 'medicine' ? 'الأدوية' : 'المواد العامة',
        item.amount,
        item.notes || ''
      ]);
    });

    rows.push([]);
    rows.push(['تفاصيل التسديدات']);
    rows.push(['التاريخ', 'رقم التسديد', 'المبلغ', 'ملاحظات']);

    report.payments.forEach(item => {
      rows.push([
        item.date,
        item.number || '',
        item.amount,
        item.notes || ''
      ]);
    });

    rows.push([]);
    rows.push(['تحليل الأصناف']);
    rows.push([
      'اسم الصنف',
      'الكمية المدفوعة',
      'البونص',
      'إجمالي المستلم',
      'قيمة المشتريات',
      'عدد مرات الشراء'
    ]);

    report.items.forEach(item => {
      rows.push([
        item.name,
        item.paidQty,
        item.bonusQty,
        item.receivedQty,
        item.total,
        item.count
      ]);
    });

    const csv = '\uFEFF' + rows
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'pharmacy-report-' + report.month + '.csv';
    link.style.display = 'none';

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function init() {
    if ($('reportMonth') && !$('reportMonth').value) {
      $('reportMonth').value = localMonth();
    }

    $('loadReportBtn')?.addEventListener('click', loadReport);
    $('exportCsvBtn')?.addEventListener('click', exportCsv);

    document.addEventListener('pharmacy:data-changed', () => {
      currentReport = null;
    });
  }

  window.PharmacyReports = Object.freeze({
    init,
    load: loadReport,
    exportCsv
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
