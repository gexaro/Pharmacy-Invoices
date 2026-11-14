(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const CATEGORIES = ['medicine', 'general'];

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

  function categoryLabel(category) {
    return category === 'medicine' ? 'الأدوية' : 'المواد العامة';
  }

  // قيمة التوزيع قد تكون رقماً مباشرة (سجلات قديمة) أو كائناً فيه amount.
  function allocationAmount(allocation) {
    if (allocation && typeof allocation === 'object') {
      return Math.max(0, Number(allocation.amount) || 0);
    }

    return Math.max(0, Number(allocation) || 0);
  }

  function discountRecorded(payment, category) {
    return Math.max(0, Number(payment.discountAmounts?.[category]) || 0);
  }

  // هل استُهلك خصم الفئة في تسديد سابق؟
  // السجلات الجديدة تحمل discountGranted، أما القديمة فتُعامل كاستهلاك
  // إذا كان لها توزيع أو خصم على الفئة.
  function discountAlreadyGranted(payments, category) {
    return payments.some(payment => {
      if (
        payment.discountGranted &&
        typeof payment.discountGranted === 'object'
      ) {
        return payment.discountGranted[category] === true;
      }

      return (
        allocationAmount(payment.allocations?.[category]) > 0 ||
        discountRecorded(payment, category) > 0
      );
    });
  }

  async function getBalances() {
    const [invoices, returns, payments] = await Promise.all([
      PharmacyDB.getAll('invoices'),
      PharmacyDB.getAll('returns'),
      PharmacyDB.getAll('payments')
    ]);

    const result = {};

    CATEGORIES.forEach(category => {
      const purchases = invoices
        .filter(item => item.category === category)
        .reduce((sum, item) => sum + Number(item.total || 0), 0);

      const returned = returns
        .filter(item => item.category === category)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

      let paid = 0;
      let discountsApplied = 0;

      payments.forEach(payment => {
        paid += allocationAmount(payment.allocations?.[category]);
        discountsApplied += discountRecorded(payment, category);
      });

      result[category] = {
        purchases: round(purchases),
        returns: round(returned),
        paid: round(paid),
        discountsApplied: round(discountsApplied),
        balance: round(
          purchases - returned - paid - discountsApplied
        )
      };
    });

    return result;
  }

  async function getDiscounts() {
    const [medicineValue, generalValue] = await Promise.all([
      PharmacyDB.getSetting('discount-medicine', 0),
      PharmacyDB.getSetting('discount-general', 0)
    ]);

    function normalize(value) {
      const number = Number(value);

      return Number.isFinite(number)
        ? Math.min(100, Math.max(0, number))
        : 0;
    }

    return {
      medicine: normalize(medicineValue),
      general: normalize(generalValue)
    };
  }

  // تعويض الرصيد الدائن لفئة مقابل مديونية الفئة الأخرى.
  function offsetCredits(balances) {
    let medicine = round(balances.medicine.balance);
    let general = round(balances.general.balance);

    let medicineCreditUsed = 0;
    let generalCreditUsed = 0;
    let remainingCredit = 0;

    if (medicine < 0 && general > 0) {
      const credit = -medicine;

      medicineCreditUsed = round(Math.min(credit, general));
      general = round(general - medicineCreditUsed);
      remainingCredit = round(credit - medicineCreditUsed);
      medicine = 0;

    } else if (general < 0 && medicine > 0) {
      const credit = -general;

      generalCreditUsed = round(Math.min(credit, medicine));
      medicine = round(medicine - generalCreditUsed);
      remainingCredit = round(credit - generalCreditUsed);
      general = 0;

    } else {
      remainingCredit = round(
        Math.max(0, -medicine) + Math.max(0, -general)
      );

      medicine = Math.max(0, medicine);
      general = Math.max(0, general);
    }

    return {
      medicine,
      general,
      medicineCreditUsed,
      generalCreditUsed,
      remainingCredit
    };
  }

  // الخصم يُحسب مرة واحدة فقط لكل فئة، على الرصيد الموجود عند أول تسديد.
  // بعد ذلك يبقى المستحق كما هو دون خصم إضافي.
  async function calculateState() {
    const [balances, discounts, payments] = await Promise.all([
      getBalances(),
      getDiscounts(),
      PharmacyDB.getAll('payments')
    ]);

    const adjusted = offsetCredits(balances);

    const granted = {};
    const grantsNow = {};
    const discountNow = {};
    const netDue = {};

    CATEGORIES.forEach(category => {
      granted[category] = discountAlreadyGranted(payments, category);

      grantsNow[category] =
        !granted[category] && adjusted[category] > 0;

      discountNow[category] = grantsNow[category]
        ? round(adjusted[category] * discounts[category] / 100)
        : 0;

      netDue[category] = round(
        adjusted[category] - discountNow[category]
      );
    });

    return {
      balances,
      adjusted,
      discounts,
      grantsNow,
      discountNow,
      netDue,
      totalDue: round(netDue.medicine + netDue.general)
    };
  }

  // توزيع المبلغ بدقة منزلتين دون تجاوز مستحق أي فئة.
  function splitPayment(amount, state) {
    const amountCents = Math.round(round(amount) * 100);
    const totalCents = Math.round(state.totalDue * 100);

    const medicineDueCents = Math.round(state.netDue.medicine * 100);
    const generalDueCents = Math.round(state.netDue.general * 100);

    if (totalCents <= 0 || amountCents <= 0) {
      return { medicine: 0, general: 0 };
    }

    let medicineCents = Math.round(
      amountCents * medicineDueCents / totalCents
    );

    medicineCents = Math.max(
      0,
      Math.min(medicineDueCents, medicineCents)
    );

    let generalCents = amountCents - medicineCents;

    if (generalCents > generalDueCents) {
      generalCents = generalDueCents;
      medicineCents = amountCents - generalCents;
    }

    if (medicineCents > medicineDueCents) {
      medicineCents = medicineDueCents;
      generalCents = amountCents - medicineCents;
    }

    return {
      medicine: medicineCents / 100,
      general: generalCents / 100
    };
  }

  function discountNote(state) {
    const parts = CATEGORIES
      .filter(category => state.discountNow[category] > 0)
      .map(category =>
        categoryLabel(category) + ' ' +
        money(state.discountNow[category]) + ' د.ع'
      );

    return parts.length
      ? ' · خصم يُطبق مرة واحدة: ' + parts.join('، ')
      : '';
  }

  async function render() {
    const state = await calculateState();
    const { balances, discounts, netDue, totalDue } = state;

    const values = {
      medicineBalance: balances.medicine.balance,
      generalBalance: balances.general.balance,
      totalBalance: round(
        balances.medicine.balance + balances.general.balance
      ),
      medicineAfterDiscount: netDue.medicine,
      generalAfterDiscount: netDue.general,
      paymentDue: totalDue
    };

    Object.entries(values).forEach(([id, value]) => {
      const element = $(id);

      if (element) {
        element.textContent = money(value) + ' د.ع';
      }
    });

    if (
      $('medicineDiscount') &&
      document.activeElement !== $('medicineDiscount')
    ) {
      $('medicineDiscount').value = String(discounts.medicine);
    }

    if (
      $('generalDiscount') &&
      document.activeElement !== $('generalDiscount')
    ) {
      $('generalDiscount').value = String(discounts.general);
    }

    updatePaymentPreview(state);

    return state;
  }

  function updatePaymentPreview(state) {
    const message = $('paymentPreviewMessage');
    if (!message) return;

    if (state.totalDue <= 0) {
      message.textContent = 'لا يوجد مبلغ مستحق للتسديد حالياً.';
      return;
    }

    const input = $('paymentAmount')?.value;

    if (input === '' || input == null) {
      message.textContent =
        'المستحق بعد الخصم: ' + money(state.totalDue) + ' د.ع.' +
        discountNote(state);
      return;
    }

    const amount = round(Number(input));

    if (!Number.isFinite(amount) || amount <= 0) {
      message.textContent = 'أدخل مبلغاً صحيحاً أكبر من صفر.';
      return;
    }

    if (amount > state.totalDue) {
      message.textContent =
        'المبلغ المدخل أكبر من المستحق بمقدار ' +
        money(amount - state.totalDue) + ' د.ع.';
      return;
    }

    const allocation = splitPayment(amount, state);

    message.textContent =
      'توزيع التسديد: الأدوية ' + money(allocation.medicine) +
      ' د.ع · المواد العامة ' + money(allocation.general) + ' د.ع' +
      discountNote(state);
  }

  async function saveDiscounts() {
    const medicine = Number($('medicineDiscount')?.value);
    const general = Number($('generalDiscount')?.value);

    if (
      !Number.isFinite(medicine) ||
      medicine < 0 ||
      medicine > 100 ||
      !Number.isFinite(general) ||
      general < 0 ||
      general > 100
    ) {
      toast('نسبة الخصم يجب أن تكون بين 0 و100%.');
      return;
    }

    try {
      await Promise.all([
        PharmacyDB.setSetting('discount-medicine', medicine),
        PharmacyDB.setSetting('discount-general', general)
      ]);

      await render();
      toast('تم حفظ نسب الخصم.');
    } catch (error) {
      toast(error.message || 'تعذر حفظ الخصومات.');
    }
  }

  async function savePayment() {
    const amount = round(Number($('paymentAmount')?.value));
    const date = $('paymentDate')?.value;

    if (!Number.isFinite(amount) || amount <= 0) {
      toast('أدخل مبلغ تسديد صحيحاً أكبر من صفر.');
      return;
    }

    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date + 'T00:00:00'))
    ) {
      toast('اختر تاريخ التسديد بصورة صحيحة.');
      return;
    }

    const button = $('savePaymentBtn');

    if (button?.disabled) return;
    if (button) button.disabled = true;

    try {
      const state = await calculateState();

      if (state.totalDue <= 0) {
        toast('لا يوجد رصيد مستحق للتسديد.');
        return;
      }

      if (amount > state.totalDue) {
        toast(
          'مبلغ التسديد أكبر من صافي المستحق (' +
          money(state.totalDue) + ' د.ع).'
        );
        return;
      }

      const allocation = splitPayment(amount, state);

      const record = {
        date,
        month: date.slice(0, 7),
        amount,

        balancesBefore: {
          medicine: state.balances.medicine.balance,
          general: state.balances.general.balance
        },

        balancesAfterCredit: {
          medicine: state.adjusted.medicine,
          general: state.adjusted.general
        },

        creditApplied: {
          medicine: state.adjusted.medicineCreditUsed,
          general: state.adjusted.generalCreditUsed
        },

        remainingCredit: state.adjusted.remainingCredit,

        discounts: {
          medicine: state.discounts.medicine,
          general: state.discounts.general
        },

        discountSnapshot: {
          medicine: state.discounts.medicine,
          general: state.discounts.general
        },

        // هل تم تطبيق الخصم في هذا التسديد؟ (مرة واحدة لكل فئة)
        discountGranted: {
          medicine: state.grantsNow.medicine,
          general: state.grantsNow.general
        },

        discountAmounts: {
          medicine: state.discountNow.medicine,
          general: state.discountNow.general
        },

        netDue: {
          medicine: state.netDue.medicine,
          general: state.netDue.general,
          total: state.totalDue
        },

        allocations: {
          medicine: allocation.medicine,
          general: allocation.general
        },

        allocationDetails: {
          medicine: {
            amount: allocation.medicine,
            remaining: round(
              Math.max(0, state.netDue.medicine - allocation.medicine)
            )
          },
          general: {
            amount: allocation.general,
            remaining: round(
              Math.max(0, state.netDue.general - allocation.general)
            )
          }
        },

        notes: String($('paymentNotes')?.value || '').trim(),
        createdAt: new Date().toISOString()
      };

      await PharmacyDB.add('payments', record);

      $('paymentAmount').value = '';

      if ($('paymentNotes')) {
        $('paymentNotes').value = '';
      }

      toast('تم تسجيل التسديد بنجاح.');

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'payment' }
        })
      );

      await render();
    } catch (error) {
      toast(error.message || 'تعذر تسجيل التسديد.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function init() {
    if ($('paymentDate') && !$('paymentDate').value) {
      $('paymentDate').value = today();
    }

    $('savePaymentBtn')?.addEventListener('click', savePayment);
    $('medicineDiscount')?.addEventListener('change', saveDiscounts);
    $('generalDiscount')?.addEventListener('change', saveDiscounts);

    $('paymentAmount')?.addEventListener('input', async () => {
      try {
        updatePaymentPreview(await calculateState());
      } catch (_) {}
    });

    document.addEventListener('pharmacy:data-changed', () => {
      render().catch(error => {
        toast(error.message || 'تعذر تحديث حساب التسديد.');
      });
    });

    render().catch(error => {
      toast(error.message || 'تعذر تحميل الأرصدة.');
    });
  }

  window.PharmacyPayments = Object.freeze({
    init,
    render,
    getBalances,
    calculateState
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
