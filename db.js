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
          try { tx.abort(); } catch (_) {}
        }
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('فشلت عملية قاعدة البيانات.'));
      tx.onabort = () => reject(tx.error || new Error('تم إلغاء عملية قاعدة البيانات.'));
    }));
  }

  function getAll(storeName) {
    if (!STORE_NAMES.includes(storeName)) {
      return Promise.reject(new Error('اسم مخزن البيانات غير صالح.'));
    }

    return openDatabase().then(db => new Promise((resolve, reject) => {
      let result;
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => { result = request.result || []; };
      request.onerror = () => reject(request.error || new Error('تعذر قراءة البيانات.'));
      tx.oncomplete = () => resolve(result || []);
      tx.onerror = () => reject(tx.error || new Error('تعذرت قراءة البيانات.'));
      tx.onabort = () => reject(tx.error || new Error('تم إلغاء عملية القراءة.'));
    }));
  }

  function add(storeName, value) {
    if (!STORE_NAMES.includes(storeName) || storeName === 'settings') {
      return Promise.reject(new Error('اسم مخزن البيانات غير صالح لهذه العملية.'));
    }

    return openDatabase().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const request = tx.objectStore(storeName).add(value);
      request.onsuccess = () => { value.id = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || request.error || new Error('تعذر حفظ البيانات.'));
      tx.onabort = () => reject(tx.error || new Error('تم إلغاء عملية الحفظ.'));
    }));
  }

  // تحقق من حد المردود وأضفه ضمن معاملة واحدة حتى لا تتجاوز عمليات النوافذ
  // المتزامنة قيمة الفاتورة أو إجمالي مشتريات الفئة.
  function addReturnWithinCapacity(value) {
    if (
      !value ||
      !['medicine', 'general'].includes(value.category) ||
      !isValidDate(value.date) ||
      !isValidNumber(value.amount) ||
      value.amount <= 0 ||
      !Number.isSafeInteger(Math.round(roundNumber(value.amount) * 100)) ||
      (value.invoiceId !== null && value.invoiceId !== undefined &&
        (!Number.isSafeInteger(value.invoiceId) || value.invoiceId <= 0))
    ) {
      return Promise.reject(new Error('بيانات المردود غير صالحة.'));
    }

    return openDatabase().then(db => new Promise((resolve, reject) => {
      let tx;
      let validationError = null;
      let settled = false;

      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      try {
        tx = db.transaction(['invoices', 'returns'], 'readwrite');
        const invoiceStore = tx.objectStore('invoices');
        const returnStore = tx.objectStore('returns');
        const invoiceRequest = invoiceStore.getAll();
        const returnRequest = returnStore.getAll();
        let invoices;
        let returns;

        const validateAndAdd = () => {
          if (!invoices || !returns) return;

          const categoryInvoices = invoices.filter(invoice =>
            invoice.category === value.category
          );
          const purchased = roundNumber(categoryInvoices.reduce(
            (sum, invoice) => sum + (Number(invoice.total) || 0), 0
          ));
          const categoryReturned = roundNumber(returns
            .filter(item => item.category === value.category)
            .reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
          let capacity = Math.max(0, roundNumber(purchased - categoryReturned));

          if (value.invoiceId !== null && value.invoiceId !== undefined) {
            const invoice = categoryInvoices.find(item =>
              String(item.id) === String(value.invoiceId)
            );
            if (!invoice) {
              validationError = new Error('الفاتورة المختارة غير موجودة أو لا تط��بق الفئة.');
              tx.abort();
              return;
            }
            const invoiceReturned = roundNumber(returns
              .filter(item => item.category === value.category &&
                String(item.invoiceId) === String(value.invoiceId))
              .reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
            capacity = Math.min(
              capacity,
              Math.max(0, roundNumber(Number(invoice.total || 0) - invoiceReturned))
            );
          }

          if (roundNumber(value.amount) > capacity) {
            validationError = new Error(
              'قيمة المردود تتجاوز الحد المتاح (' + capacity + ' د.ع).'
            );
            tx.abort();
            return;
          }

          const addRequest = returnStore.add(value);
          addRequest.onsuccess = () => { value.id = addRequest.result; };
          addRequest.onerror = () => {
            validationError = addRequest.error || new Error('تعذر حفظ المردود.');
          };
        };

        invoiceRequest.onsuccess = () => {
          invoices = invoiceRequest.result || [];
          validateAndAdd();
        };
        returnRequest.onsuccess = () => {
          returns = returnRequest.result || [];
          validateAndAdd();
        };
        invoiceRequest.onerror = () => {
          validationError = invoiceRequest.error || new Error('تعذر فحص الفواتير.');
          try { tx.abort(); } catch (_) {}
        };
        returnRequest.onerror = () => {
          validationError = returnRequest.error || new Error('تعذر فحص المردودات.');
          try { tx.abort(); } catch (_) {}
        };

        tx.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        tx.onerror = () => fail(validationError || tx.error || new Error('تعذر حفظ المردود.'));
        tx.onabort = () => fail(validationError || tx.error || new Error('تم إلغاء حفظ المردود.'));
      } catch (error) {
        if (tx) {
          try { tx.abort(); } catch (_) {}
        }
        fail(error);
      }
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
      tx.onerror = () => reject(tx.error || request.error || new Error('تعذر تحديث البيانات.'));
      tx.onabort = () => reject(tx.error || new Error('تم إلغاء عملية التحديث.'));
    }));
  }

  function remove(storeName, key) {
    if (!STORE_NAMES.includes(storeName)) {
      return Promise.reject(new Error('اسم مخزن البيانات غير صالح.'));
    }
    return transaction([storeName], 'readwrite', tx =>
      tx.objectStore(storeName).delete(key)
    );
  }

  function clearAll() {
    return transaction(STORE_NAMES, 'readwrite', tx => {
      STORE_NAMES.forEach(name => tx.objectStore(name).clear());
    });
  }

  async function getSetting(key, fallback = null) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('settings', 'readonly');
      const request = tx.objectStore('settings').get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : fallback);
      request.onerror = () => reject(request.error || new Error('تعذر قراءة الإعدادات.'));
      tx.onabort = () => reject(tx.error || new Error('تم إلغاء قراءة الإعدادات.'));
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
      data: { invoices, returns, payments, settings }
    };
  }

  function isValidNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  }

  function validCategory(value) {
    return value === 'medicine' || value === 'general';
  }

  function getAllocationAmount(allocation) {
    if (isValidNumber(allocation)) return allocation;
    if (allocation && typeof allocation === 'object' && isValidNumber(allocation.amount)) {
      return allocation.amount;
    }
    return null;
  }

  function roundNumber(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function validateBackup(backup) {
    if (
      !backup ||
      backup.format !== 'pharmacy-invoices-backup' ||
      backup.version !== 1 ||
      !backup.data ||
      typeof backup.data !== 'object'
    ) {
      throw new Error('ملف النسخة الاحتياطية غير صالح أو لا يخص هذا التطبيق.');
    }

    for (const name of STORE_NAMES) {
      if (!Array.isArray(backup.data[name])) {
        throw new Error('ملف النسخة الاحتياطية ناقص أو تالف: ' + name);
      }
    }

    for (const name of ['invoices', 'returns', 'payments']) {
      const ids = new Set();
      backup.data[name].forEach(record => {
        if (!record || !Number.isSafeInteger(record.id) || record.id <= 0 || ids.has(record.id)) {
          throw new Error('توجد معرّفات مفقودة أو مكررة داخل ' + name + '.');
        }
        ids.add(record.id);
      });
    }

    backup.data.invoices.forEach(invoice => {
      if (
        !validCategory(invoice.category) ||
        !Array.isArray(invoice.items) ||
        !isValidNumber(invoice.total) ||
        invoice.total < 0 ||
        !Number.isSafeInteger(Math.round(invoice.total * 100)) ||
        !isValidDate(invoice.date)
      ) {
        throw new Error('توجد فاتورة غير صالحة داخل النسخة الاحتياطية.');
      }

      let itemSum = 0;
      invoice.items.forEach(item => {
        if (
          !item ||
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          !Number.isSafeInteger(item.paidQty) ||
          item.paidQty <= 0 ||
          !Number.isSafeInteger(item.bonusQty) ||
          item.bonusQty < 0 ||
          !isValidNumber(item.unitPrice) ||
          item.unitPrice < 0 ||
          !isValidNumber(item.itemTotal) ||
          item.itemTotal < 0 ||
          !Number.isSafeInteger(Math.round(item.itemTotal * 100)) ||
          Math.abs(roundNumber(item.paidQty * item.unitPrice) - item.itemTotal) > 0.02
        ) {
          throw new Error('يوجد صنف غير صالح أو غير متسق داخل إحدى الفواتير.');
        }
        itemSum += item.itemTotal;
      });

      if (Math.abs(roundNumber(itemSum) - invoice.total) > 0.02) {
        throw new Error('إجمالي إحدى الفواتير لا يطابق مجموع أصنافها.');
      }
    });

    backup.data.returns.forEach(item => {
      if (
        !validCategory(item.category) ||
        !isValidNumber(item.amount) ||
        item.amount <= 0 ||
        !Number.isSafeInteger(Math.round(item.amount * 100)) ||
        !isValidDate(item.date) ||
        (item.invoiceId !== null && item.invoiceId !== undefined &&
          (!Number.isSafeInteger(item.invoiceId) || item.invoiceId <= 0))
      ) {
        throw new Error('يوجد مردود غير صالح داخل النسخة الاحتياطية.');
      }
    });

    backup.data.payments.forEach(item => {
      if (
        !item ||
        !isValidNumber(item.amount) ||
        item.amount <= 0 ||
        !Number.isSafeInteger(Math.round(item.amount * 100)) ||
        !isValidDate(item.date) ||
        !item.allocations ||
        typeof item.allocations !== 'object'
      ) {
        throw new Error('يوجد تسديد غير صالح داخل النسخة الاحتياطية.');
      }

      const medicine = getAllocationAmount(item.allocations.medicine);
      const general = getAllocationAmount(item.allocations.general);
      if (medicine === null || general === null || medicine < 0 || general < 0) {
        throw new Error('توزيع أحد التسديدات غير صالح داخل النسخة الاحتياطية.');
      }

      if (Math.abs(roundNumber(medicine + general) - item.amount) > 0.02) {
        throw new Error('مجموع توزيع أحد التسديدات لا يطابق مبلغ التسديد.');
      }

      const snapshot = item.discountSnapshot || item.discounts;
      if (snapshot && (
        !Number.isFinite(Number(snapshot.medicine)) ||
        !Number.isFinite(Number(snapshot.general)) ||
        Number(snapshot.medicine) < 0 || Number(snapshot.medicine) > 100 ||
        Number(snapshot.general) < 0 || Number(snapshot.general) > 100
      )) {
        throw new Error('نسب الخصم في أحد التسديدات غير صالحة.');
      }
    });

    const settingKeys = new Set();
    backup.data.settings.forEach(item => {
      if (
        !item ||
        typeof item.key !== 'string' ||
        !item.key.trim() ||
        !Object.prototype.hasOwnProperty.call(item, 'value') ||
        settingKeys.has(item.key)
      ) {
        throw new Error('يوجد إعداد غير صالح أو مكرر داخل النسخة الاحتياطية.');
      }
      settingKeys.add(item.key);
    });
  }

  async function importBackup(backup) {
    validateBackup(backup);
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAMES, 'readwrite');
        STORE_NAMES.forEach(name => {
          const store = tx.objectStore(name);
          store.clear();
          backup.data[name].forEach(record => store.put(record));
        });
      } catch (error) {
        if (tx) {
          try { tx.abort(); } catch (_) {}
        }
        reject(error);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('فشلت استعادة النسخة الاحتياطية.'));
      tx.onabort = () => reject(tx.error || new Error('تم إلغاء استعادة النسخة الاحتياطية.'));
    });
  }

  window.PharmacyDB = Object.freeze({
    open: openDatabase,
    getAll,
    add,
    addReturnWithinCapacity,
    put,
    remove,
    clearAll,
    getSetting,
    setSetting,
    exportBackup,
    importBackup
  });
})();
