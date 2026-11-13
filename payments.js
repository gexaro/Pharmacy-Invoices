
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
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getDiscountAmount(payment, category) {
    const recorded = payment.discountAmounts?.[category];

    if (
      recorded !== undefined &&
      recorded !== null &&
      Number.isFinite(Number(recorded))
    ) {
      return Math.max(0, Number(recorded));
    }

    const before = Number(
      payment.balancesAfterCredit?.[category]
    );

    const after = Number(
      payment.netDue?.[category]
    );

    if (
      Number.isFinite(before) &&
      Number.isFinite(after) &&
      before >= after
    ) {
      return round(before - after);
    }

    return 0;
  }

  async function getBalances() {
    const [invoices, returns, payments] = await Promise.all([
      PharmacyDB.getAll('invoices'),
      PharmacyDB.getAll('returns'),
      PharmacyDB.getAll('payments')
    ]);

    const result = {};

    for (const category of ['medicine', 'general']) {
      const purchases = invoices
        .filter(item => item.category === category)
        .reduce((sum, item) => sum + Number(item.total || 0), 0);

      const returned = returns
        .filter(item => item.category === category)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

      let paid = 0;
      let discountsApplied = 0;

      payments.forEach(payment => {
        const allocation = payment.allocations?.[category];

        const value = typeof allocation === 'object'
          ? allocation?.amount
          : allocation;

        paid += Number(value || 0);
        discountsApplied += getDiscountAmount(
          payment,
          category
        );
      });

      result[category] = {
        purchases: round(purchases),
        returns: round(returned),
        paid: round(paid),
        discountsApplied: round(discountsApplied),
        balance: round(
          purchases -
          returned -
          paid -
          discountsApplied
        )
      };
    }

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

      medicineCreditUsed = round(
        Math.min(credit, general)
      );

      general = round(general - medicineCreditUsed);
      remainingCredit = round(credit - medicineCreditUsed);
      medicine = 0;

    } else if (general < 0 && medicine > 0) {
      const credit = -general;

      generalCreditUsed = round(
        Math.min(credit, medicine)
      );

      medicine = round(medicine - generalCreditUsed);
      remainingCredit = round(credit - generalCreditUsed);
      general = 0;

    } else {
      remainingCredit = round(
        Math.max(0, -medicine) +
        Math.max(0, -general)
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

  function calculateNet(balance, discount) {
    return round(
      Math.max(0, balance) * (1 - discount / 100)
    );
  }

  async function calculateState() {
    const [balances, discounts] = await Promise.all([
      getBalances(),
      getDiscounts()
    ]);

    const adjusted = offsetCredits(balances);

    const medicineNet = calculateNet(
      adjusted.medicine,
      discounts.medicine
    );

    const generalNet = calculateNet(
      adjusted.general,
      discounts.general
    );

    return {
      balances,
      adjusted,
      discounts,
      medicineNet,
      generalNet,
      totalDue: round(medicineNet + generalNet)
    };
  }

  // توزيع المبلغ بدقة منزلتين دون تجاوز رصيد أي فئة.
  function splitPayment(amount, state) {
    const amountCents = Math.round(round(amount) * 100);
    const totalCents = Math.round(state.totalDue * 100);

    const medicineDueCents = Math.round(
      state.medicineNet * 100
    );

    const generalDueCents = Math.round(
      state.generalNet * 100
    );

    if (totalCents <= 0 || amountCents <= 0) {
      return {
        medicine: 0,
        general: 0
      };
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

  async function render() {
    const state = await calculateState();

    const {
      balances,
      discounts,
      medicineNet,
      generalNet,
      totalDue
    } = state;

    const values = {
      medicineBalance: balances.medicine.balance,
      generalBalance: balances.general.balance,
      totalBalance: round(
        balances.medicine.balance + balances.general.balance
      ),
      medicineAfterDiscount: medicineNet,
      generalAfterDiscount: generalNet,
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

    const message = $('paymentPreviewMessage');

    if (message && totalDue <= 0) {
      const credit = Math.abs(
        Math.min(
          0,
          balances.medicine.balance + balances.general.balance
        )
      );

      message.textContent = credit > 0
        ? 'لا يوجد مبلغ مستحق حالياً. الرصيد الدائن المتبقي: ' +
          money(credit) + ' د.ع.'
        : 'لا يوجد مبلغ مستحق للتسديد حالياً.';
    }

    return state;
  }

  function updatePaymentPreview(state) {
    const message = $('paymentPreviewMessage');
    if (!message) return;

    const input = $('paymentAmount')?.value;

    if (input === '' || input == null) {
      message.textContent =
        'المستحق بعد تعويض الأرصدة الدائنة والخصم: ' +
        money(state.totalDue) + ' د.ع.';
      return;
    }

    const amount = round(Number(input));

    if (!Number.isFinite(amount) || amount <= 0) {
      message.textContent =
        'أدخل مبلغاً صحيحاً أكبر من صفر.';
      return;
    }

    if (amount > state.totalDue) {
      message.textContent =
        'المبلغ المدخل أكبر من المستحق بمقدار ' +
        money(amount - state.totalDue) + ' د.ع.';
      return;
    }

    if (state.totalDue <= 0) {
      message.textContent = 'لا يوجد مبلغ مستحق للتسديد.';
      return;
    }

    const allocation = splitPayment(amount, state);

    message.textContent =
      'توزيع التسديد: الأدوية ' +
      money(allocation.medicine) +
      ' د.ع · المواد العامة ' +
      money(allocation.general) + ' د.ع';
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
    const amount = round(
      Number($('paymentAmount')?.value)
    );

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

      const discountAmounts = {
        medicine: round(
          state.adjusted.medicine - state.medicineNet
        ),
        general: round(
          state.adjusted.general - state.generalNet
        )
      };

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

        discountAmounts,

        netDue: {
          medicine: state.medicineNet,
          general: state.generalNet,
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
              Math.max(0, state.medicineNet - allocation.medicine)
            )
          },
          general: {
            amount: allocation.general,
            remaining: round(
              Math.max(0, state.generalNet - allocation.general)
            )
          }
        },

        notes: String(
          $('paymentNotes')?.value || ''
        ).trim(),

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

    $('savePaymentBtn')?.addEventListener(
      'click',
      savePayment
    );

    $('medicineDiscount')?.addEventListener(
      'change',
      saveDiscounts
    );

    $('generalDiscount')?.addEventListener(
      'change',
      saveDiscounts
    );

    $('paymentAmount')?.addEventListener(
      'input',
      async () => {
        try {
          updatePaymentPreview(await calculateState());
        } catch (_) {}
      }
    );

    document.addEventListener(
      'pharmacy:data-changed',
      () => {
        render().catch(error => {
          toast(error.message || 'تعذر تحديث حساب التسديد.');
        });
      }
    );

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
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
