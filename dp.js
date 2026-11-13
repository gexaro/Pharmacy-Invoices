
"use strict";

/*
 * Pharmacy Purchase Manager
 * Local IndexedDB database
 *
 * Database:
 *   PharmacyPurchaseDB
 *
 * Stores:
 *   invoices
 *   returns
 *   payments
 *   settings
 */

const DB_NAME = "PharmacyPurchaseDB";
const DB_VERSION = 1;

const DB_STORES = {
  INVOICES: "invoices",
  RETURNS: "returns",
  PAYMENTS: "payments",
  SETTINGS: "settings"
};

let databasePromise = null;

/* ================================
   Database initialization
================================ */

function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(
      new Error("المتصفح لا يدعم قاعدة البيانات المحلية")
    );
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Invoices
      if (!db.objectStoreNames.contains(DB_STORES.INVOICES)) {
        const store = db.createObjectStore(
          DB_STORES.INVOICES,
          {
            keyPath: "id",
            autoIncrement: true
          }
        );

        store.createIndex("date", "date", { unique: false });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("invoiceNumber", "invoiceNumber", { unique: false });
        store.createIndex("month", "month", { unique: false });
      }

      // Returns
      if (!db.objectStoreNames.contains(DB_STORES.RETURNS)) {
        const store = db.createObjectStore(
          DB_STORES.RETURNS,
          {
            keyPath: "id",
            autoIncrement: true
          }
        );

        store.createIndex("date", "date", { unique: false });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("invoiceId", "invoiceId", { unique: false });
        store.createIndex("month", "month", { unique: false });
      }

      // Payments and discount records
      if (!db.objectStoreNames.contains(DB_STORES.PAYMENTS)) {
        const store = db.createObjectStore(
          DB_STORES.PAYMENTS,
          {
            keyPath: "id",
            autoIncrement: true
          }
        );

        store.createIndex("date", "date", { unique: false });
        store.createIndex("month", "month", { unique: false });
      }

      // Application settings
      if (!db.objectStoreNames.contains(DB_STORES.SETTINGS)) {
        db.createObjectStore(
          DB_STORES.SETTINGS,
          {
            keyPath: "key"
          }
        );
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
      reject(request.error || new Error("تعذر فتح قاعدة البيانات"));
    };

    request.onblocked = () => {
      databasePromise = null;
      reject(
        new Error("قاعدة البيانات مشغولة. أغلق النسخ الأخرى من التطبيق.")
      );
    };
  });

  return databasePromise;
}

/* ================================
   Store validation
================================ */

function validateStore(storeName) {
  const allowed = Object.values(DB_STORES);

  if (!allowed.includes(storeName)) {
    throw new Error("اسم قاعدة البيانات غير صالح");
  }
}

/* ================================
   Generic database operation
================================ */

async function runTransaction(storeNames, mode, operation) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    let transaction;

    try {
      transaction = db.transaction(storeNames, mode);

      const result = operation(transaction);

      transaction.oncomplete = () => {
        resolve(result);
      };

      transaction.onerror = () => {
        reject(
          transaction.error || new Error("حدث خطأ أثناء حفظ البيانات")
        );
      };

      transaction.onabort = () => {
        reject(
          transaction.error || new Error("تم إلغاء العملية")
        );
      };

    } catch (error) {
      reject(error);
    }
  });
}

/* ================================
   Add record
================================ */

async function dbAdd(storeName, data) {
  validateStore(storeName);

  return runTransaction(
    [storeName],
    "readwrite",
    (transaction) => {
      const store = transaction.objectStore(storeName);
      const request = store.add(data);

      request.onerror = () => {
        console.error("Database add error:", request.error);
      };

      return request;
    }
  ).then((request) => request.result);
}

/* ================================
   Update or insert record
================================ */

async function dbPut(storeName, data) {
  validateStore(storeName);

  return runTransaction(
    [storeName],
    "readwrite",
    (transaction) => {
      const store = transaction.objectStore(storeName);
      return store.put(data);
    }
  ).then((request) => request.result);
}

/* ================================
   Get record by ID
================================ */

async function dbGet(storeName, id) {
  validateStore(storeName);

  return runTransaction(
    [storeName],
    "readonly",
    (transaction) => {
      return transaction.objectStore(storeName).get(id);
    }
  ).then((request) => request.result);
}

/* ================================
   Get all records
================================ */

async function dbGetAll(storeName) {
  validateStore(storeName);

  return runTransaction(
    [storeName],
    "readonly",
    (transaction) => {
      return transaction.objectStore(storeName).getAll();
    }
  ).then((request) => request.result || []);
}

/* ================================
   Get records by index
================================ */

async function dbGetByIndex(storeName, indexName, value) {
  validateStore(storeName);

  return runTransaction(
    [storeName],
    "readonly",
    (transaction) => {
      const store = transaction.objectStore(storeName);

      if (!store.indexNames.contains(indexName)) {
        throw new Error("الفهرس المطلوب غير موجود");
      }

      return store.index(indexName).getAll(value);
    }
  ).then((request) => request.result || []);
}

/* ================================
   Delete record
================================ */

async function dbDelete(storeName, id) {
  validateStore(storeName);

  return runTransaction(
    [storeName],
    "readwrite",
    (transaction) => {
      return transaction.objectStore(storeName).delete(id);
    }
  );
}

/* ================================
   Clear one store
================================ */

async function dbClear(storeName) {
  validateStore(storeName);

  return runTransaction(
    [storeName],
    "readwrite",
    (transaction) => {
      return transaction.objectStore(storeName).clear();
    }
  );
}

/* ================================
   Settings
================================ */

async function dbSaveSetting(key, value) {
  if (!key) {
    throw new Error("مفتاح الإعداد غير صالح");
  }

  return dbPut(DB_STORES.SETTINGS, {
    key,
    value,
    updatedAt: new Date().toISOString()
  });
}

async function dbGetSetting(key, defaultValue = null) {
  const setting = await dbGet(DB_STORES.SETTINGS, key);

  return setting ? setting.value : defaultValue;
}

/* ================================
   Backup export
================================ */

async function dbExportBackup() {
  const db = await openDatabase();

  const backup = {
    application: "Pharmacy Purchase Manager",
    formatVersion: 1,
    databaseVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data: {}
  };

  for (const storeName of Object.values(DB_STORES)) {
    backup.data[storeName] = await dbGetAll(storeName);
  }

  return backup;
}

/* ================================
   Backup validation
================================ */

function validateBackup(backup) {
  if (!backup || typeof backup !== "object") {
    throw new Error("ملف النسخة الاحتياطية غير صالح");
  }

  if (backup.application !== "Pharmacy Purchase Manager") {
    throw new Error("هذا الملف ليس نسخة احتياطية لهذا التطبيق");
  }

  if (backup.formatVersion !== 1 || !backup.data) {
    throw new Error("إصدار النسخة الاحتياطية غير مدعوم");
  }

  for (const storeName of Object.values(DB_STORES)) {
    if (!Array.isArray(backup.data[storeName])) {
      throw new Error("بيانات النسخة الاحتياطية غير مكتملة");
    }
  }

  return true;
}

/* ================================
   Backup import / restore
================================ */

async function dbImportBackup(backup) {
  validateBackup(backup);

  const db = await openDatabase();
  const storeNames = Object.values(DB_STORES);

  return new Promise((resolve, reject) => {
    let transaction;

    try {
      transaction = db.transaction(storeNames, "readwrite");

      for (const storeName of storeNames) {
        const store = transaction.objectStore(storeName);

        store.clear();

        const records = backup.data[storeName];

        for (const record of records) {
          store.put(record);
        }
      }

      transaction.oncomplete = () => {
        resolve(true);
      };

      transaction.onerror = () => {
        reject(
          transaction.error || new Error("فشلت استعادة النسخة الاحتياطية")
        );
      };

      transaction.onabort = () => {
        reject(
          transaction.error || new Error("تم إلغاء الاستعادة")
        );
      };

    } catch (error) {
      if (transaction) {
        try {
          transaction.abort();
        } catch (_) {}
      }

      reject(error);
    }
  });
}

/* ================================
   Clear complete database
================================ */

async function dbClearAll() {
  const db = await openDatabase();
  const storeNames = Object.values(DB_STORES);

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, "readwrite");

    for (const storeName of storeNames) {
      transaction.objectStore(storeName).clear();
    }

    transaction.oncomplete = () => resolve(true);

    transaction.onerror = () => {
      reject(transaction.error || new Error("تعذر حذف البيانات"));
    };

    transaction.onabort = () => {
      reject(transaction.error || new Error("تم إلغاء الحذف"));
    };
  });
}

/* ================================
   Date helpers
================================ */

function dbGetMonth(dateValue) {
  if (!dateValue) return "";

  return String(dateValue).slice(0, 7);
}

function dbGetCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

/* ================================
   Currency helper
================================ */

function dbFormatMoney(value) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(number) + " د.ع";
}

/* ================================
   Database readiness
================================ */

async function dbInitialize() {
  try {
    await openDatabase();
    console.info("Pharmacy database initialized successfully");
    return true;
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}
