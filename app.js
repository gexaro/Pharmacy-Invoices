
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const money = value =>
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2
    }).format(Number(value) || 0);

  let toastTimer = null;

  function toast(message) {
    const element = $('toast');

    if (!element) {
      alert(message);
      return;
    }

    element.textContent = String(message);
    element.classList.add('show');

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      element.classList.remove('show');
    }, 3000);
  }

  window.PharmacyApp = Object.freeze({ toast });

  function localDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  function localMonth() {
    return localDate().slice(0, 7);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register('./sw.js')
        .catch(() => {});
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, {
        once: true
      });
    }
  }

  function showPage(page) {
    const panels = document.querySelectorAll('[data-page-panel]');
    const buttons = document.querySelectorAll('[data-page]');

    const target = document.querySelector(
      '[data-page-panel="' + page + '"]'
    );

    if (!target) return;

    panels.forEach(panel => {
      const active = panel === target;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });

    buttons.forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle('active', active);
      button.setAttribute(
        'aria-current',
        active ? 'page' : 'false'
      );
    });

    if (page === 'dashboard') {
      refreshDashboard();
    }

    if (page === 'archive') {
      renderArchive();
    }

    if (page === 'payment') {
      window.PharmacyPayments?.render();
    }

    if (page === 'reports') {
      window.PharmacyReports?.load();
    }

    window.scrollTo({
      top: 0,
      behavior: 'auto'
    });
  }

  function initNavigation() {
    document.querySelectorAll('[data-page]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        showPage(button.dataset.page);
      });
    });

    showPage('dashboard');
  }

  function initTheme() {
    const root = document.documentElement;

    let saved = 'light';

    try {
      saved = localStorage.getItem('pharmacy-invoices-theme') || 'light';
    } catch (_) {}

    const initial = saved === 'dark' ? 'dark' : 'light';

    function apply(theme) {
      root.dataset.theme = theme;

      const icon = $('themeIcon');
      const button = $('themeToggle');

      if (icon) {
        icon.textContent = theme === 'dark' ? '☀' : '☾';
      }

      if (button) {
        button.setAttribute(
          'aria-label',
          theme === 'dark'
            ? 'تفعيل الوضع الفاتح'
            : 'تفعيل الوضع الداكن'
        );
      }

      try {
        localStorage.setItem('pharmacy-invoices-theme', theme);
      } catch (_) {}
    }

    apply(initial);

    $('themeToggle')?.addEventListener('click', () => {
      apply(
        root.dataset.theme === 'dark' ? 'light' : 'dark'
      );
    });
  }

  async function refreshDashboard() {
    try {
      const [invoices, returns, payments] = await Promise.all([
        PharmacyDB.getAll('invoices'),
        PharmacyDB.getAll('returns'),
        PharmacyDB.getAll('payments')
      ]);

      const month = localMonth();

      const purchases = invoices
        .filter(item => item.date?.startsWith(month))
        .reduce(
          (sum, item) => sum + Number(item.total || 0),
          0
        );

      const returned = returns
        .filter(item => item.date?.startsWith(month))
        .reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0
        );

      const paid = payments
        .filter(item => item.date?.startsWith(month))
        .reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0
        );

      const balances = window.PharmacyPayments
        ? await window.PharmacyPayments.getBalances()
        : null;

      const totalBalance = balances
        ? balances.medicine.balance + balances.general.balance
        : 0;

      const medicineBalance =
        balances?.medicine.balance || 0;

      const generalBalance =
        balances?.general.balance || 0;

      const supplier = await PharmacyDB.getSetting(
        'supplier-name',
        'المورد'
      );

      const supplierElement = $('supplierBalance');

      if (supplierElement) {
        supplierElement.textContent =
          money(totalBalance) + ' د.ع';
      }

      const supplierName = $('supplierName');

      if (
        supplierName &&
        document.activeElement !== supplierName
      ) {
        supplierName.value = supplier || '';
      }

      const today = $('todayDate');

      if (today) {
        today.textContent = new Intl.DateTimeFormat('ar-IQ', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }).format(new Date());
      }

      const values = {
        monthlyPurchases: purchases,
        monthlyReturns: returned,
        monthlyPayments: paid,
        dashboardMedicineBalance: medicineBalance,
        dashboardGeneralBalance: generalBalance
      };

      Object.entries(values).forEach(([id, value]) => {
        const element = $(id);

        if (element) {
          element.textContent = money(value) + ' د.ع';
        }
      });
    } catch (error) {
      toast(error.message || 'تعذر تحديث لوحة التحكم.');
    }
  }

  function appendArchiveCard(container, title, details, amount) {
    const card = document.createElement('article');
    card.className = 'record-card';

    const head = document.createElement('div');
    head.className = 'record-card-head';

    const heading = document.createElement('strong');
    heading.textContent = title;

    const value = document.createElement('strong');
    value.className = 'record-value';
    value.textContent = money(amount) + ' د.ع';

    head.append(heading, value);

    const meta = document.createElement('div');
    meta.className = 'record-meta';
    meta.textContent = details;

    card.append(head, meta);
    container.append(card);
  }

  async function renderArchive() {
    const list = $('archiveList');
    if (!list) return;

    try {
      const [invoices, returns, payments] = await Promise.all([
        PharmacyDB.getAll('invoices'),
        PharmacyDB.getAll('returns'),
        PharmacyDB.getAll('payments')
      ]);

      const query = String($('archiveSearch')?.value || '')
        .trim()
        .toLocaleLowerCase();

      const records = [];

      invoices.forEach(item => {
        const names = (item.items || [])
          .map(entry => entry.name || '')
          .join(' ');

        records.push({
          type: 'فاتورة',
          date: item.date,
          number: item.number,
          category:
            item.category === 'medicine'
              ? 'الأدوية'
              : 'المواد العامة',
          amount: item.total,
          notes: item.notes,
          searchable: [
            item.number,
            item.notes,
            names,
            item.date,
            'فاتورة'
          ].join(' ')
        });
      });

      returns.forEach(item => {
        records.push({
          type: 'مردود',
          date: item.date,
          number: item.number,
          category:
            item.category === 'medicine'
              ? 'الأدوية'
              : 'المواد العامة',
          amount: item.amount,
          notes: item.notes,
          searchable: [
            item.number,
            item.notes,
            item.date,
            'مردود'
          ].join(' ')
        });
      });

      payments.forEach(item => {
        records.push({
          type: 'تسديد',
          date: item.date,
          number: item.number,
          category: 'حساب المورد',
          amount: item.amount,
          notes: item.notes,
          searchable: [
            item.number,
            item.notes,
            item.date,
            'تسديد'
          ].join(' ')
        });
      });

      const filtered = records
        .filter(item =>
          !query ||
          item.searchable.toLocaleLowerCase().includes(query)
        )
        .sort((a, b) =>
          String(b.date || '').localeCompare(
            String(a.date || '')
          )
        );

      list.replaceChildren();

      if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = query
          ? 'لا توجد نتائج مطابقة للبحث.'
          : 'لا توجد عمليات مسجلة.';

        list.append(empty);
        return;
      }

      filtered.forEach(item => {
        const title = item.number
          ? item.type + ' رقم ' + item.number
          : item.type;

        const details = [
          item.date || '',
          item.category,
          item.notes || ''
        ].filter(Boolean).join(' · ');

        appendArchiveCard(
          list,
          title,
          details,
          item.amount
        );
      });
    } catch (error) {
      toast(error.message || 'تعذر تحميل الأرشيف.');
    }
  }

  async function saveSettings() {
    const name = String($('supplierName')?.value || '').trim();

    if (!name) {
      toast('أدخل اسم المورد.');
      return;
    }

    try {
      await PharmacyDB.setSetting('supplier-name', name);
      toast('تم حفظ بيانات المورد.');
    } catch (error) {
      toast(error.message || 'تعذر حفظ الإعدادات.');
    }
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function exportBackup() {
    try {
      const backup = await PharmacyDB.exportBackup();

      downloadFile(
        JSON.stringify(backup, null, 2),
        'pharmacy-backup-' + localDate() + '.json',
        'application/json;charset=utf-8'
      );

      toast('تم إنشاء النسخة الاحتياطية.');
    } catch (error) {
      toast(error.message || 'تعذر إنشاء النسخة الاحتياطية.');
    }
  }

  async function restoreBackup() {
    const file = $('restoreFile')?.files?.[0];

    if (!file) {
      toast('اختر ملف النسخة الاحتياطية أولاً.');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast('حجم الملف أكبر من الحد المسموح (20 MB).');
      return;
    }

    if (!confirm(
      'تحذير: استعادة النسخة الاحتياطية ستستبدل جميع البيانات الحالية. هل تريد المتابعة؟'
    )) {
      return;
    }

    try {
      const content = await file.text();
      const backup = JSON.parse(content);

      await PharmacyDB.importBackup(backup);

      $('restoreFile').value = '';

      toast('تمت استعادة النسخة الاحتياطية.');

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'restore' }
        })
      );

      await refreshDashboard();
      await renderArchive();
      await window.PharmacyPayments?.render();
    } catch (error) {
      toast(error.message || 'تعذرت استعادة النسخة الاحتياطية.');
    }
  }

  async function clearData() {
    if (!confirm(
      'هل أنت متأكد؟ سيتم حذف جميع الفواتير والمردودات والتسديدات والإعدادات نهائياً من هذا الجهاز.'
    )) {
      return;
    }

    if (!confirm(
      'تأكيد أخير: لا يمكن التراجع عن حذف البيانات.'
    )) {
      return;
    }

    try {
      await PharmacyDB.clearAll();

      toast('تم حذف جميع البيانات.');

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'clear' }
        })
      );

      await refreshDashboard();
      await renderArchive();
      await window.PharmacyPayments?.render();
    } catch (error) {
      toast(error.message || 'تعذر حذف البيانات.');
    }
  }

  function init() {
    initTheme();
    initNavigation();

    $('saveSettingsBtn')?.addEventListener(
      'click',
      saveSettings
    );

    $('backupBtn')?.addEventListener(
      'click',
      exportBackup
    );

    $('restoreBtn')?.addEventListener(
      'click',
      restoreBackup
    );

    $('clearDataBtn')?.addEventListener(
      'click',
      clearData
    );

    $('archiveSearch')?.addEventListener(
      'input',
      renderArchive
    );

    document.addEventListener(
      'pharmacy:data-changed',
      () => {
        refreshDashboard();

        if (!$('page-archive')?.hidden) {
          renderArchive();
        }
      }
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) {
          refreshDashboard();
        }
      }
    );

    refreshDashboard();
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {
      once: true
    });
  } else {
    init();
  }
})();
