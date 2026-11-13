
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

  function round(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  async function getBalances() {
    const [invoices, returns, payments] = await Promise.all([
      window.PharmacyDB.getAll('invoices'),
      window.PharmacyDB.getAll('returns'),
      window.PharmacyDB.getAll('payments')
    ]);

    const result = {};

    for (const category of ['medicine', 'general']) {
      const purchases = invoices
        .filter(item => item.category === category)
        .reduce((sum, item) => sum + Number(item.total || 0), 0);

      const returned = returns
        .filter(item => item.category === category)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);

      const paid = payments.reduce((sum, payment) => {
        const allocation = payment.allocations?.[category];
        return sum + Number(allocation?.amount || 0);
      }, 0);

      result[category] = {
        purchases: round(purchases),
        returns: round(returned),
        paid: round(paid),
        balance: round(purchases - returned - paid)
      };
    }

    return result;
  }

  async function getDiscounts() {
    const medicine = Number(
      await window.PharmacyDB.getSetting('discount-medicine')
    ) || 0;

    const general = Number(
      await window.PharmacyDB.getSetting('discount-general')
    ) || 0;

    return {
      medicine: Math.min(100, Math.max(0, medicine)),
      general: Math.min(100, Math.max(0, general))
    };
  }

  async function saveDiscounts() {
    const medicine = Number($('medicineDiscount')?.value);
    const general = Number($('generalDiscount')?.value);

    if (!Number.isFinite(medicine) || medicine < 0 || medicine > 100 ||
        !Number.isFinite(general) || general < 0 || general > 100) {
      toast('نسبة الخصم يجب أن تكون بين 0 و100%.');
      return;
    }

    try {
      await Promise.all([
        window.PharmacyDB.setSetting('discount-medicine', medicine),
        window.PharmacyDB.setSetting('discount-general', general)
      ]);

      toast('تم حفظ نسب الخصم.');
      await render();
    } catch (error) {
      toast(error.message || 'تعذر حفظ الخصومات.');
    }
  }

  async function render() {
    try {
      const [balances, discounts] = await Promise.all([
        getBalances(),
        getDiscounts()
      ]);

      const fields = {
        medicineBalance: balances.medicine.balance,
        generalBalance: balances.general.balance,
        totalBalance: round(
          balances.medicine.balance + balances.general.balance
        )
      };

      Object.entries(fields).forEach(([id, value]) => {
        const element = $(id);
        if (element) {
          element.textContent = money(value) + ' د.ع';
        }
      });

      if ($('medicineDiscount')) {
        $('medicineDiscount').value = String(discounts.medicine);
      }

      if ($('generalDiscount')) {
        $('generalDiscount').value = String(discounts.general);
      }

      const medicineNet = round(
        Math.max(0, balances.medicine.balance) *
        (1 - discounts.medicine / 100)
      );

      const generalNet = round(
        Math.max(0, balances.general.balance) *
        (1 - discounts.general / 100)
      );

      if ($('medicineAfterDiscount')) {
        $('medicineAfterDiscount').textContent =
          money(medicineNet) + ' د.ع';
      }

      if ($('generalAfterDiscount')) {
        $('generalAfterDiscount').textContent =
          money(generalNet) + ' د.ع';
      }

      if ($('paymentDueTotal')) {
        $('paymentDueTotal').textContent =
          money(medicineNet + generalNet) + ' د.ع';
      }

      return { balances, discounts, medicineNet, generalNet };
    } catch (error) {
      toast(error.message || 'تعذر تحميل الأرصدة.');
      throw error;
    }
  }

  async function savePayment() {
    const amount = Number($('paymentAmount')?.value);
    const date = $('paymentDate')?.value;
    const number = String($('paymentNumber')?.value || '').trim();
    const notes = String($('paymentNotes')?.value || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      toast('أدخل مبلغ تسديد صحيحاً أكبر من صفر.');
      return;
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast('اختر تاريخ التسديد.');
      return;
    }

    const button = $('savePaymentBtn');
    if (button) button.disabled = true;

    try {
      const state = await render();
      const { balances, discounts, medicineNet, generalNet } = state;

      const totalDue = round(medicineNet + generalNet);

      if (totalDue <= 0) {
        toast('لا يوجد رصيد مستحق للتسديد.');
        return;
      }

      if (amount > totalDue + 0.001) {
        toast(
          'مبلغ التسديد أكبر من صافي المستحق (' +
          money(totalDue) + ' د.ع).'
        );
        return;
      }

      const ratio = amount / totalDue;

      const medicineAmount = round(medicineNet * ratio);
      const generalAmount = round(amount - medicineAmount);

      const record = {
        date,
        month: date.slice(0, 7),
        number,
        notes,
        amount: round(amount),
        balancesBefore: {
          medicine: balances.medicine.balance,
          general: balances.general.balance
        },
        discounts: {
          medicine: discounts.medicine,
          general: discounts.general
        },
        discountAmounts: {
          medicine: round(
            Math.max(0, balances.medicine.balance) - medicineNet
          ),
          general: round(
            Math.max(0, balances.general.balance) - generalNet
          )
        },
        netDue: {
          medicine: medicineNet,
          general: generalNet,
          total: totalDue
        },
        allocations: {
          medicine: {
            amount: medicineAmount,
            remaining: round(medicineNet - medicineAmount)
          },
          general: {
            amount: generalAmount,
            remaining: round(generalNet - generalAmount)
          }
        },
        createdAt: new Date().toISOString()
      };

      await window.PharmacyDB.add('payments', record);

      if ($('paymentAmount')) $('paymentAmount').value = '';
      if ($('paymentNumber')) $('paymentNumber').value = '';
      if ($('paymentNotes')) $('paymentNotes').value = '';

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
      $('paymentDate').value = new Date().toISOString().slice(0, 10);
    }

    $('savePaymentBtn')?.addEventListener('click', savePayment);
    $('saveDiscountsBtn')?.addEventListener('click', saveDiscounts);

    document.addEventListener('pharmacy:data-changed', render);

    render();
  }

  window.PharmacyPayments = Object.freeze({
    init,
    render,
    getBalances
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
