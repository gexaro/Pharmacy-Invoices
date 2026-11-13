
(function () {
  'use strict';

  const DB_NAME = 'PharmacyInvoicesDB';
  const DB_VERSION = 1;
  const STORE_NAMES = ['invoices', 'returns', 'payments', 'settings'];

  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        databasePromise = null;
        reject(new Error('هذا المتصفح لا يدعم قاعدة البيانات المحلية IndexedDB.'));
        return;
      }

      let request;

      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        databasePromise = null;
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('invoices')) {
          const store = db.createObjectStore('invoices', {
            keyPath: 'id',
            autoIncrement: true
          });

          store.createIndex('date', 'date', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('month', 'month', { unique: false });
        }

        if (!db.objectStoreNames.contains('returns')) {
          const store = db.createObjectStore('returns', {
            keyPath: 'id',
            autoIncrement: true
          });

          store.createIndex('date', 'date', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('invoiceId', 'invoiceId', { unique: false });
        }

        if (!db.objectStoreNames.contains('payments')) {
          const store = db.createObjectStore('payments', {
            keyPath: 'id',
            autoIncrement: true
          });

          store.createIndex('date', 'date', { unique: false });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          databasePromise = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error('تعذر فتح قاعدة البيانات.'));
      };

      request.onblocked = () => {
        databasePromise = null;
        reject(new Error(
          'قاعدة البيانات مشغولة في نافذة أخرى. أغلق النسخ الأخرى من التطبيق ثم أعد المحاولة.'
        ));
      };
    });

    return databasePromise;
  }

  function transaction(storeNames, mode, operation) {
    return openDatabase().then(db => new Promise((resolve, reject) => {
      let tx;
      let result;

      try {
        tx = db.transaction(storeNames, mode);
        result = operation(tx);
      } catch (error) {
        if (tx) {
          try {
            tx.abort();
          } catch (_) {}
        }

        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result);

      tx.onerror = () => {
        reject(tx.error || new Error('فشلت عملية قاعدة البيانات.'));
      };

      tx.onabort = () => {
        reject(tx.error || new Error('تم إلغاء عملية قاعدة البيانات.'));
      };
    }));
  }

  function getAll(storeName) {
    if (!STORE_NAMES.includes(storeName)) {
      return Promise.reject(new Error('اسم مخزن البيانات غير صالح.'));
    }

    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error || new Error('تعذر قراءة البيانات.'));
      };

      tx.onabort = () => {
        reject(tx.error || new Error('تم إلغاء عملية القراءة.'));
      };
    }));
  }

  function add(storeName, value) {
    if (
      !STORE_NAMES.includes(storeName) ||
      storeName === 'settings'
    ) {
      return Promise.reject(
        new Error('اسم مخزن البيانات غير صالح لهذه العملية.')
      );
    }

    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).add(value);

      request.onsuccess = () => {
        value.id = request.result;
      };

      tx.oncomplete = () => resolve(value);

      tx.onerror = () => {
        reject(tx.error || request.error || new Error('تعذر حفظ البيانات.'));
      };

      tx.onabort = () => {
        reject(tx.error || new Error('تم إلغاء عملية الحفظ.'));
      };
    }));
  }

  function put(storeName, value) {
    if (!STORE_NAMES.includes(storeName)) {
      return Promise.reject(new Error('اسم مخزن البيانات غير صالح.'));
    }

    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).put(value);

      tx.oncomplete = () => resolve(value);

      tx.onerror = () => {
        reject(tx.error || request.error || new Error('تعذر تحديث البيانات.'));
      };

      tx.onabort = () => {
        reject(tx.error || new Error('تم إلغاء عملية التحديث.'));
      };
    }));
  }

  function remove(storeName, key) {
    if (!STORE_NAMES.includes(storeName)) {
      return Promise.reject(new Error('اسم مخزن البيانات غير صالح.'));
    }

    return transaction(
      [storeName],
      'readwrite',
      tx => tx.objectStore(storeName).delete(key)
    );
  }

  function clearAll() {
    return transaction(STORE_NAMES, 'readwrite', tx => {
      STORE_NAMES.forEach(name => {
        tx.objectStore(name).clear();
      });
    });
  }

  async function getSetting(key, fallback = null) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const request = tx.objectStore('settings').get(key);

      request.onsuccess = () => {
        resolve(request.result ? request.result.value : fallback);
      };

      request.onerror = () => {
        reject(request.error || new Error('تعذر قراءة الإعدادات.'));
      };

      tx.onabort = () => {
        reject(tx.error || new Error('تم إلغاء قراءة الإعدادات.'));
      };
    });
  }

  async function setSetting(key, value) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('اسم الإعداد غير صالح.');
    }

    return put('settings', {
      key,
      value,
      updatedAt: new Date().toISOString()
    });
  }

  async function exportBackup() {
    const [invoices, returns, payments, settings] = await Promise.all(
      STORE_NAMES.map(name => getAll(name))
    );

    return {
      format: 'pharmacy-invoices-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        invoices,
        returns,
        payments,
        settings
      }
    };
  }

  function isValidNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isValidDate(value) {
    return (
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value + 'T00:00:00'))
    );
  }

  function validCategory(value) {
    return value === 'medicine' || value === 'general';
  }

  function getAllocationAmount(allocation) {
    if (isValidNumber(allocation)) {
      return allocation;
    }

    if (
      allocation &&
      typeof allocation === 'object' &&
      isValidNumber(allocation.amount)
    ) {
      return allocation.amount;
    }

    return null;
  }

  function validateBackup(backup) {
    if (
      !backup ||
      backup.format !== 'pharmacy-invoices-backup' ||
      backup.version !== 1 ||
      !backup.data ||
      typeof backup.data !== 'object'
    ) {
      throw new Error(
        'ملف النسخة الاحتياطية غير صالح أو لا يخص هذا التطبيق.'
      );
    }

    for (const name of STORE_NAMES) {
      if (!Array.isArray(backup.data[name])) {
        throw new Error(
          'ملف النسخة الاحتياطية ناقص أو تالف: ' + name
        );
      }
    }

    // التحقق من الفواتير.
    backup.data.invoices.forEach(invoice => {
      if (
        !invoice ||
        !validCategory(invoice.category) ||
        !Array.isArray(invoice.items) ||
        !isValidNumber(invoice.total) ||
        invoice.total < 0 ||
        !isValidDate(invoice.date)
      ) {
        throw new Error(
          'توجد فاتورة غير صالحة داخل النسخة الاحتياطية.'
        );
      }

      invoice.items.forEach(item => {
        if (
          !item ||
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          !isValidNumber(item.paidQty) ||
          !Number.isInteger(item.paidQty) ||
          item.paidQty <= 0 ||
          !isValidNumber(item.bonusQty) ||
          !Number.isInteger(item.bonusQty) ||
          item.bonusQty < 0 ||
          !isValidNumber(item.unitPrice) ||
          item.unitPrice < 0 ||
          !isValidNumber(item.itemTotal) ||
          item.itemTotal < 0
        ) {
          throw new Error(
            'يوجد صنف غير صالح داخل إحدى الفواتير.'
          );
        }
      });
    });

    // التحقق من المردودات.
    backup.data.returns.forEach(item => {
      if (
        !item ||
        !validCategory(item.category) ||
        !isValidNumber(item.amount) ||
        item.amount <= 0 ||
        !isValidDate(item.date)
      ) {
        throw new Error(
          'يوجد مردود غير صالح داخل النسخة الاحتياطية.'
        );
      }
    });

    // التحقق من التسديدات، مع دعم الشكل القديم والجديد.
    backup.data.payments.forEach(item => {
      if (
        !item ||
        !isValidNumber(item.amount) ||
        item.amount <= 0 ||
        !isValidDate(item.date) ||
        !item.allocations ||
        typeof item.allocations !== 'object'
      ) {
        throw new Error(
          'يوجد تسديد غير صالح داخل النسخة الاحتياطية.'
        );
      }

      const medicine = getAllocationAmount(
        item.allocations.medicine
      );

      const general = getAllocationAmount(
        item.allocations.general
      );

      if (
        medicine === null ||
        general === null ||
        medicine < 0 ||
        general < 0
      ) {
        throw new Error(
          'توزيع أحد التسديدات غير صالح داخل النسخة الاحتياطية.'
        );
      }

      if (Math.abs(roundNumber(medicine + general) - item.amount) > 0.02) {
        throw new Error(
          'مجموع توزيع أحد التسديدات لا يطابق مبلغ التسديد.'
        );
      }

      // يدعم discountSnapshot أو discounts في السجلات القديمة.
      const snapshot = item.discountSnapshot || item.discounts;

      if (
        snapshot &&
        (
          !isValidNumber(Number(snapshot.medicine)) ||
          !isValidNumber(Number(snapshot.general)) ||
          Number(snapshot.medicine) < 0 ||
          Number(snapshot.medicine) > 100 ||
          Number(snapshot.general) < 0 ||
          Number(snapshot.general) > 100
        )
      ) {
        throw new Error(
          'نسب الخصم في أحد التسديدات غير صالحة.'
        );
      }
    });

    // التحقق من الإعدادات.
    backup.data.settings.forEach(item => {
      if (
        !item ||
        typeof item.key !== 'string' ||
        !item.key.trim() ||
        !Object.prototype.hasOwnProperty.call(item, 'value')
      ) {
        throw new Error(
          'يوجد إعداد غير صالح داخل النسخة الاحتياطية.'
        );
      }
    });
  }

  function roundNumber(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  async function importBackup(backup) {
    // لا يتم مسح أي بيانات قبل اجتياز جميع اختبارات النسخة.
    validateBackup(backup);

    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      let tx;

      try {
        tx = db.transaction(STORE_NAMES, 'readwrite');

        STORE_NAMES.forEach(name => {
          const store = tx.objectStore(name);

          store.clear();

          backup.data[name].forEach(record => {
            store.put(record);
          });
        });
      } catch (error) {
        if (tx) {
          try {
            tx.abort();
          } catch (_) {}
        }

        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(true);

      tx.onerror = () => {
        reject(
          tx.error || new Error('فشلت استعادة النسخة الاحتياطية.')
        );
      };

      tx.onabort = () => {
        reject(
          tx.error || new Error('تم إلغاء استعادة النسخة الاحتياطية.')
        );
      };
    });
  }

  window.PharmacyDB = Object.freeze({
    open: openDatabase,
    getAll,
    add,
    put,
    remove,
    clearAll,
    getSetting,
    setSetting,
    exportBackup,
    importBackup
  });
})();
