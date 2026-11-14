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

  let draft = null;
  let items = [];

  let blockingErrors = [];
  let confirmableMismatch = null;
  let duplicateNeedsConfirmation = false;
  let warnings = [];

  let duplicateFound = false;
  let saving = false;

  let mismatchApprovedKey = null;
  let duplicateApprovedKey = null;

  function toast(message) {
    if (window.PharmacyApp?.toast) {
      window.PharmacyApp.toast(message);
    } else {
      alert(message);
    }
  }

  function isBlank(value) {
    return value === undefined ||
      value === null ||
      String(value).trim() === '';
  }

  // يعيد null إذا كانت القيمة فارغة أو غير رقمية، ولا يحولها إلى صفر أبداً.
  function numberValue(value) {
    if (isBlank(value)) return null;

    const normalized = String(value)
      .replace(/[,٬\s]/g, '')
      .trim();

    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
      return null;
    }

    const number = Number(normalized);

    return Number.isFinite(number) ? number : null;
  }

  function isPositiveInteger(value) {
    return value !== null &&
      Number.isSafeInteger(value) &&
      value > 0;
  }

  function isNonNegativeInteger(value) {
    return value !== null &&
      Number.isSafeInteger(value) &&
      value >= 0;
  }

  function isMeaningful(text) {
    const value = String(text || '').trim();

    return value !== '' &&
      !/^(none|null|-|لا يوجد|لا توجد)$/i.test(value);
  }

  function dateValue(value) {
    const match = String(value || '').trim().match(
      /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/
    );

    if (!match) return '';

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return '';
    }

    return [
      String(year).padStart(4, '0'),
      String(month).padStart(2, '0'),
      String(day).padStart(2, '0')
    ].join('-');
  }

  function parseFields(section) {
    const result = {};

    String(section || '').split(/\r?\n/).forEach(line => {
      const match = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);

      if (match) {
        result[match[1].trim()] = match[2].trim();
      }
    });

    return result;
  }

  function getSection(text, start, end) {
    const startIndex = text.indexOf(start);

    if (startIndex < 0) return '';

    const contentStart = startIndex + start.length;
    const endIndex = end
      ? text.indexOf(end, contentStart)
      : -1;

    return text.slice(
      contentStart,
      endIndex < 0 ? undefined : endIndex
    );
  }

  function parseItemBlocks(text) {
    const blocks = [];
    const regex = /^\s*ITEM\s*$/gm;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const start = regex.lastIndex;
      const end = text.indexOf('END_ITEM', start);

      if (end < 0) {
        throw new Error(
          'يوجد ITEM بدون END_ITEM. تحقق من اكتمال النص.'
        );
      }

      blocks.push(parseFields(text.slice(start, end)));

      regex.lastIndex = end + 'END_ITEM'.length;
    }

    return blocks;
  }

  function prepareItem(data, index) {
    return {
      name: String(data.item_name || '').trim(),
      paidQty: numberValue(data.paid_quantity),
      bonusQty: numberValue(data.bonus_quantity),
      receivedQty: numberValue(data.total_received_quantity),
      unitPrice: numberValue(data.unit_price),
      itemTotal: numberValue(data.line_total),
      effectiveUnitCost: numberValue(data.actual_unit_cost),
      manufacturer: data.manufacturer || '',
      strength: data.strength || '',
      dosageForm: data.dosage_form || '',
      packageSize: data.package_size || '',
      barcode: data.barcode || '',
      batchNumber: data.batch_number || '',
      expiryDate: data.expiry_date || '',
      pageNumber: numberValue(data.page_number),
      rowNumber: numberValue(data.row_number),
      confidence: data.confidence || '',
      notes: data.notes || '',
      sourceCategory: data.category || '',
      sourceIndex: index,
      errors: []
    };
  }

  function readInvoice(text) {
    if (!text.includes('PHARMACY_INVOICE_DATA_V1')) {
      throw new Error(
        'صيغة النص غير صحيحة. لم يتم العثور على PHARMACY_INVOICE_DATA_V1.'
      );
    }

    const header = parseFields(
      getSection(text, '[INVOICE]', '[ITEMS]')
    );

    const summary = parseFields(
      getSection(text, '[SUMMARY]', '[UNCERTAIN_DATA]')
    );

    const duplicate = parseFields(
      getSection(text, '[DUPLICATE_CHECK]', '[SUMMARY]')
    );

    const uncertain = getSection(
      text,
      '[UNCERTAIN_DATA]',
      '[END_INVOICE]'
    );

    const itemBlocks = parseItemBlocks(
      getSection(text, '[ITEMS]', '[DISCOUNTS]')
    );

    if (!itemBlocks.length) {
      throw new Error('لم يتم العثور على أصناف داخل الفاتورة.');
    }

    const firstCategory = itemBlocks.find(
      item => CATEGORIES.includes(item.category)
    )?.category || 'medicine';

    return {
      header,
      summary,
      duplicate,
      uncertain,
      items: itemBlocks.map(prepareItem),
      category: firstCategory,
      sourceText: text
    };
  }

  function setValue(id, value) {
    const element = $(id);

    if (element) {
      element.value = value ?? '';
    }
  }

  function showError(message) {
    const element = $('invoiceImportError');

    if (!element) return;

    element.textContent = message;
    element.hidden = false;
  }

  function hideError() {
    const element = $('invoiceImportError');

    if (element) {
      element.textContent = '';
      element.hidden = true;
    }
  }

  function showReview() {
    $('invoiceImportReview').hidden = false;
  }

  function hideReview() {
    $('invoiceImportReview').hidden = true;
  }

  function fillHeader() {
    const h = draft.header;

    setValue('importSupplier', h.supplier);
    setValue('importCustomer', h.customer);
    setValue('importInvoiceNumber', h.invoice_number);
    setValue('importInvoiceDate', dateValue(h.invoice_date));
    setValue('importRepresentative', h.representative);
    setValue('importRepresentativePhone', h.representative_phone);
    setValue('importInvoiceType', h.invoice_type);
    setValue('importPrintedTotal', h.printed_total);
    setValue('importInvoiceCategory', draft.category);
  }

  function showHeaderWarnings() {
    const element = $('importHeaderWarnings');
    const h = draft.header;

    const messages = [];

    if (isBlank(h.box_count)) {
      messages.push('عدد الصناديق غير متوفر.');
    }

    if (isBlank(h.previous_balance)) {
      messages.push('الرصيد السابق غير متوفر.');
    }

    element.textContent = messages.join(' ');
    element.hidden = messages.length === 0;
  }

  function calculateTotal() {
    return round(
      items.reduce(
        (sum, item) => sum + Number(item.itemTotal || 0),
        0
      )
    );
  }

  // إعادة حساب القيم المشتقة عند تعديل الكمية أو السعر.
  function recalculateItem(item) {
    if (item.paidQty !== null && item.unitPrice !== null) {
      item.itemTotal = round(item.paidQty * item.unitPrice);
    }

    if (item.paidQty !== null && item.bonusQty !== null) {
      item.receivedQty = item.paidQty + item.bonusQty;
    }

    if (item.receivedQty > 0 && item.itemTotal !== null) {
      item.effectiveUnitCost = round(
        item.itemTotal / item.receivedQty
      );
    }
  }

  function validateItem(item) {
    const errors = [];

    if (!item.name.trim()) {
      errors.push('اسم الصنف مطلوب.');
    }

    if (!isPositiveInteger(item.paidQty)) {
      errors.push('الكمية المدفوعة غير صحيحة.');
    }

    if (!isNonNegativeInteger(item.bonusQty)) {
      errors.push('كمية البونص غير صحيحة.');
    }

    if (!isNonNegativeInteger(item.receivedQty)) {
      errors.push('الكمية المستلمة غير صحيحة.');
    }

    if (
      item.paidQty !== null &&
      item.bonusQty !== null &&
      item.receivedQty !== null &&
      item.receivedQty !== item.paidQty + item.bonusQty
    ) {
      errors.push('الكمية المستلمة لا تساوي المدفوع + البونص.');
    }

    if (item.unitPrice === null || item.unitPrice < 0) {
      errors.push('سعر الوحدة غير صحيح.');
    }

    if (item.itemTotal === null || item.itemTotal < 0) {
      errors.push('قيمة السطر غير موجودة أو غير صحيحة.');
    }

    if (
      item.paidQty !== null &&
      item.unitPrice !== null &&
      item.itemTotal !== null &&
      Math.abs(round(item.paidQty * item.unitPrice) - item.itemTotal) > 0.02
    ) {
      errors.push('قيمة السطر لا تطابق الكمية المدفوعة × السعر.');
    }

    return errors;
  }

  function currentMismatchKey() {
    const printed = numberValue($('importPrintedTotal')?.value);
    return calculateTotal() + '|' + printed;
  }

  function currentDuplicateKey() {
    return [
      String($('importInvoiceNumber')?.value || '').trim(),
      String($('importSupplier')?.value || '').trim(),
      $('importInvoiceDate')?.value || '',
      calculateTotal()
    ].join('|');
  }

  function validateDraft() {
    blockingErrors = [];
    confirmableMismatch = null;
    duplicateNeedsConfirmation = false;
    warnings = [];

    if (isBlank($('importSupplier')?.value)) {
      blockingErrors.push('اسم المورد غير موجود.');
    }

    if (isBlank($('importInvoiceNumber')?.value)) {
      blockingErrors.push('رقم الفاتورة غير موجود.');
    }

    if (!dateValue($('importInvoiceDate')?.value)) {
      blockingErrors.push('تاريخ الفاتورة غير صحيح.');
    }

    const selectedCategory = $('importInvoiceCategory')?.value;

    if (!CATEGORIES.includes(selectedCategory)) {
      blockingErrors.push('اختر فئة الفاتورة.');
    }

    if (!items.length) {
      blockingErrors.push('لا توجد أصناف في هذه الفاتورة.');
    }

    items.forEach((item, index) => {
      item.errors = validateItem(item);

      if (item.errors.length) {
        blockingErrors.push(
          'الصنف ' + (index + 1) + ' (' + (item.name || 'بدون اسم') + '): ' +
          item.errors.join(' ')
        );
      }

      if (
        item.sourceCategory &&
        item.sourceCategory !== selectedCategory
      ) {
        blockingErrors.push(
          'تصنيف الصنف ' + (item.name || index + 1) +
          ' لا يطابق فئة الفاتورة المختارة.'
        );
      }

      if (
        item.confidence &&
        item.confidence.toUpperCase() !== 'HIGH'
      ) {
        warnings.push(
          'ثقة استخراج الصنف ' + (item.name || index + 1) +
          ' ليست HIGH. راجعه يدوياً.'
        );
      }
    });

    const pageCount = numberValue(draft.header.page_count);

    if (pageCount !== null && pageCount > 1) {
      const foundPages = new Set(
        items
          .map(item => item.pageNumber)
          .filter(value => Number.isInteger(value) && value > 0)
      );

      if (foundPages.size < pageCount) {
        blockingErrors.push(
          'الفاتورة تشير إلى ' + pageCount + ' صفحات، لكن النص لا يحتوي أصنافاً من جميع الصفحات. أضف نص الصفحات الناقصة قبل الحفظ.'
        );
      }
    }

    const printed = numberValue($('importPrintedTotal')?.value);
    const calculated = calculateTotal();

    if (printed === null) {
      blockingErrors.push(
        'الإجمالي المطبوع غير موجود في النص. إذا كانت الفاتورة من أكثر من صفحة، تأكد من لصق نص الصفحة الأخيرة التي تحتوي الإجمالي.'
      );
    } else if (Math.abs(printed - calculated) > 0.02) {
      confirmableMismatch =
        'الإجمالي المحسوب (' + money(calculated) +
        ') لا يطابق الإجمالي المطبوع (' + money(printed) +
        '). راجع الفرق وأكد ذلك.';
    }

    const summaryCount = numberValue(draft.summary.items_count);

    if (summaryCount !== null && summaryCount !== items.length) {
      blockingErrors.push(
        'عدد الأصناف لا يطابق العدد المذكور في الملخص.'
      );
    }

    const summaryTotal = numberValue(draft.summary.sum_of_line_totals);

    if (
      summaryTotal !== null &&
      Math.abs(summaryTotal - calculated) > 0.02
    ) {
      blockingErrors.push(
        'مجموع قيم الأصناف لا يطابق مجموع الأصناف المذكور في الملخص.'
      );
    }

    const duplicateStatus = String(
      draft.duplicate.duplicate_status || 'NONE'
    ).toUpperCase();

    if (duplicateFound) {
      duplicateNeedsConfirmation = true;
      warnings.push(
        'وجدت فاتورة سابقة برقم ومورد وتاريخ مشابه. يلزم تأكيد أنها فاتورة مستقلة.'
      );
    }

    if (duplicateStatus !== 'NONE') {
      duplicateNeedsConfirmation = true;
      warnings.push(
        'بيانات النص تشير إلى احتمال وجود نسخة مكررة.'
      );
    }

    if (draft.duplicate.requires_manual_confirmation === 'YES') {
      duplicateNeedsConfirmation = true;
      warnings.push('النص يتطلب تأكيداً يدوياً بشأن التكرار.');
    }

    if (isMeaningful(draft.uncertain)) {
      warnings.push(
        'توجد بيانات غير مؤكدة في النص الأصلي. راجعها قبل الحفظ.'
      );
    }
  }

  function renderMessages() {
    const container = $('importValidationMessages');

    if (!container) return;

    container.replaceChildren();

    const all = [
      ...blockingErrors.map(text => ({
        text,
        className: 'error-message'
      })),
      ...(confirmableMismatch
        ? [{ text: confirmableMismatch, className: 'info-strip' }]
        : []),
      ...warnings.map(text => ({
        text,
        className: 'info-strip'
      }))
    ];

    if (!all.length) {
      all.push({
        text: 'اجتازت الفاتورة الفحص الأولي.',
        className: 'info-strip'
      });
    }

    all.forEach(entry => {
      const row = document.createElement('p');
      row.className = 'message-box ' + entry.className;
      row.textContent = entry.text;
      container.append(row);
    });
  }

  function updateReview() {
    validateDraft();

    const calculated = calculateTotal();
    const printed = numberValue($('importPrintedTotal')?.value);

    const paid = items.reduce(
      (sum, item) => sum + Number(item.paidQty || 0), 0
    );
    const bonus = items.reduce(
      (sum, item) => sum + Number(item.bonusQty || 0), 0
    );
    const received = items.reduce(
      (sum, item) => sum + Number(item.receivedQty || 0), 0
    );

    $('importItemCount').textContent = String(items.length);
    $('importSummaryItems').textContent = String(items.length);
    $('importSummaryPaid').textContent = String(paid);
    $('importSummaryBonus').textContent = String(bonus);
    $('importSummaryReceived').textContent = String(received);
    $('importSummaryCalculated').textContent = money(calculated) + ' د.ع';

    $('importSummaryPrinted').textContent =
      printed === null ? 'غير متوفر' : money(printed) + ' د.ع';

    $('importSummaryDifference').textContent =
      printed === null
        ? 'غير قابل للتحقق'
        : money(round(printed - calculated)) + ' د.ع';

    // تأكيد فرق الإجمالي: يُلغى تلقائياً إذا تغيرت الأرقام بعد التأكيد.
    const mismatchRow = $('importMismatchConfirmRow');
    const mismatchCheck = $('importConfirmMismatch');

    mismatchRow.hidden = !confirmableMismatch;

    const mismatchKey = confirmableMismatch ? currentMismatchKey() : null;

    if (mismatchApprovedKey !== mismatchKey) {
      mismatchCheck.checked = false;
      mismatchApprovedKey = null;
    }

    const mismatchApproved = !confirmableMismatch || mismatchCheck.checked;

    // تأكيد التكرار: يُلغى تلقائياً إذا تغيرت الفاتورة بعد التأكيد.
    const duplicateRow = $('importDuplicateConfirmRow');
    const duplicateCheck = $('importConfirmDuplicate');

    duplicateRow.hidden = !duplicateNeedsConfirmation;

    const duplicateKey = duplicateNeedsConfirmation
      ? currentDuplicateKey()
      : null;

    if (duplicateApprovedKey !== duplicateKey) {
      duplicateCheck.checked = false;
      duplicateApprovedKey = null;
    }

    const duplicateApproved =
      !duplicateNeedsConfirmation || duplicateCheck.checked;

    const canSave =
      !saving &&
      items.length > 0 &&
      blockingErrors.length === 0 &&
      mismatchApproved &&
      duplicateApproved;

    $('saveImportedInvoiceBtn').disabled = !canSave;

    const status = $('importInvoiceStatus');

    if (status) {
      status.textContent = canSave ? 'جاهزة للحفظ' : 'تحتاج مراجعة';
    }
  }

  function renderItems() {
    const container = $('importItemsReview');

    if (!container) return;

    container.replaceChildren();

    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'panel import-item-card';

      const heading = document.createElement('div');
      heading.className = 'section-heading';

      const title = document.createElement('strong');
      title.textContent = (index + 1) + '. ' + (item.name || 'بدون اسم');

      const badge = document.createElement('span');
      badge.className = 'count-badge';
      badge.textContent = item.bonusQty > 0 ? 'يتضمن بونص' : 'صنف';

      heading.append(title, badge);

      const fields = document.createElement('div');
      fields.className = 'form-grid';

      fields.append(
        createItemField('اسم الصنف', item.name, value => {
          item.name = String(value).trim();
        }),
        createItemField('الكمية المدفوعة', item.paidQty ?? '', value => {
          item.paidQty = numberValue(value);
          recalculateItem(item);
        }, 'number'),
        createItemField('كمية البونص', item.bonusQty ?? '', value => {
          item.bonusQty = numberValue(value);
          recalculateItem(item);
        }, 'number'),
        createItemField('الكمية المستلمة', item.receivedQty ?? '', value => {
          item.receivedQty = numberValue(value);
        }, 'number'),
        createItemField('سعر الوحدة', item.unitPrice ?? '', value => {
          item.unitPrice = numberValue(value);
          recalculateItem(item);
        }, 'number'),
        createItemField('قيمة السطر', item.itemTotal ?? '', value => {
          item.itemTotal = numberValue(value);
        }, 'number')
      );

      const details = document.createElement('p');
      details.className = 'hint-text';
      details.textContent =
        'الشركة: ' + (item.manufacturer || 'غير محددة') +
        ' · التركيز: ' + (item.strength || 'غير محدد') +
        ' · الشكل: ' + (item.dosageForm || 'غير محدد') +
        ' · العبوة: ' + (item.packageSize || 'غير محددة');

      const batch = document.createElement('p');
      batch.className = 'hint-text';
      batch.textContent =
        'التشغيلة: ' + (item.batchNumber || 'غير متوفرة') +
        ' · الصلاحية: ' + (item.expiryDate || 'غير متوفرة') +
        ' · التكلفة الفعلية للوحدة: ' +
        (item.effectiveUnitCost === null
          ? 'غير متوفرة'
          : money(item.effectiveUnitCost));

      card.append(heading, fields, details, batch);

      if (item.notes) {
        const note = document.createElement('p');
        note.className = 'hint-text';
        note.textContent = item.notes;
        card.append(note);
      }

      (item.errors || []).forEach(message => {
        const error = document.createElement('p');
        error.className = 'message-box error-message';
        error.textContent = message;
        card.append(error);
      });

      container.append(card);
    });
  }

  function createItemField(labelText, value, onChange, type = 'text') {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';

    const label = document.createElement('label');
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';

    if (type === 'number') {
      input.min = '0';
      input.step = 'any';
      input.inputMode = 'decimal';
    }

    input.addEventListener('change', () => {
      onChange(input.value);
      refresh();
    });

    wrapper.append(label, input);

    return wrapper;
  }

  function refresh() {
    updateReview();
    renderItems();
  }

  async function checkDuplicates() {
    duplicateFound = false;

    const number = String(
      $('importInvoiceNumber')?.value || ''
    ).trim();

    if (!number || !window.PharmacyDB) return;

    try {
      const invoices = await window.PharmacyDB.getAll('invoices');

      const supplier = String(
        $('importSupplier')?.value || ''
      ).trim().toLocaleLowerCase();

      const date = $('importInvoiceDate')?.value;

      duplicateFound = invoices.some(invoice => {
        if (String(invoice.number || '').trim() !== number) {
          return false;
        }

        const oldSupplier = String(
          invoice.supplier || ''
        ).trim().toLocaleLowerCase();

        const sameSupplier =
          !supplier || !oldSupplier || supplier === oldSupplier;

        const sameDate = !date || invoice.date === date;

        return sameSupplier && sameDate;
      });
    } catch (error) {
      toast('تعذر فحص الفواتير المكررة. تحقق يدوياً قبل الحفظ.');
    }
  }

  async function parseInvoice() {
    hideError();

    try {
      const text = String(
        $('invoiceImportText')?.value || ''
      ).trim();

      if (!text) {
        throw new Error('الصق نص الفاتورة أولاً.');
      }

      draft = readInvoice(text);
      items = draft.items.map(item => ({ ...item }));

      mismatchApprovedKey = null;
      duplicateApprovedKey = null;

      fillHeader();
      showHeaderWarnings();

      await checkDuplicates();

      refresh();
      showReview();

      $('invoiceImportReview').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });

      toast('تم تحليل الفاتورة. راجع البيانات قبل الحفظ.');

    } catch (error) {
      draft = null;
      items = [];
      hideReview();
      showError(error.message || 'تعذر تحليل الفاتورة.');
    }
  }

  function clearImport() {
    if (saving) return;

    $('invoiceImportText').value = '';

    hideError();
    hideReview();

    draft = null;
    items = [];
    duplicateFound = false;
    mismatchApprovedKey = null;
    duplicateApprovedKey = null;

    $('importConfirmMismatch').checked = false;
    $('importConfirmDuplicate').checked = false;
  }

  function cancelReview() {
    if (saving) return;

    hideReview();

    draft = null;
    items = [];
    duplicateFound = false;
    mismatchApprovedKey = null;
    duplicateApprovedKey = null;

    toast('تم إلغاء المراجعة. لم يتم حفظ أي بيانات.');
  }

  async function saveImportedInvoice() {
    if (!draft || saving) return;

    refresh();

    const button = $('saveImportedInvoiceBtn');

    if (button.disabled) {
      toast('راجع الأخطاء والتأكيدات المطلوبة قبل الحفظ.');
      return;
    }

    saving = true;
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ...';

    try {
      const date = dateValue($('importInvoiceDate').value);
      const category = $('importInvoiceCategory').value;

      const invoiceItems = items.map(item => {
        const itemTotal = round(item.itemTotal);

        return {
          name: item.name.trim(),
          paidQty: item.paidQty,
          bonusQty: item.bonusQty,
          receivedQty: item.receivedQty,
          unitPrice: item.unitPrice,
          itemTotal,
          effectiveUnitCost: item.effectiveUnitCost,
          manufacturer: item.manufacturer,
          strength: item.strength,
          dosageForm: item.dosageForm,
          packageSize: item.packageSize,
          barcode: item.barcode,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          pageNumber: item.pageNumber,
          rowNumber: item.rowNumber,
          confidence: item.confidence,
          notes: item.notes
        };
      });

      const total = round(
        invoiceItems.reduce(
          (sum, item) => sum + item.itemTotal,
          0
        )
      );

      const supplier = String($('importSupplier').value || '').trim();
      const customer = String($('importCustomer').value || '').trim();
      const representative = String($('importRepresentative').value || '').trim();
      const representativePhone = String($('importRepresentativePhone').value || '').trim();
      const invoiceType = String($('importInvoiceType').value || '').trim();

      const invoice = {
        category,
        number: String($('importInvoiceNumber').value || '').trim(),
        date,
        month: date.slice(0, 7),
        notes: [
          'فاتورة مستوردة من نص منظم.',
          'المورد: ' + supplier,
          'العميل: ' + customer,
          'المندوب: ' + representative,
          'هاتف المندوب: ' + representativePhone,
          'نوع الفاتورة: ' + invoiceType
        ].join('\n'),
        supplier,
        customer,
        representative,
        representativePhone,
        invoiceType,
        printedTotal: numberValue($('importPrintedTotal').value),
        items: invoiceItems,
        total,
        importSource: 'PHARMACY_INVOICE_DATA_V1',
        importSummary: draft.summary,
        importUncertainData: draft.uncertain,
        importOriginalText: draft.sourceText,
        createdAt: new Date().toISOString()
      };

      await window.PharmacyDB.add('invoices', invoice);

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'invoice-import' }
        })
      );

      $('invoiceImportText').value = '';

      hideReview();
      hideError();

      draft = null;
      items = [];
      duplicateFound = false;
      mismatchApprovedKey = null;
      duplicateApprovedKey = null;

      toast('تم حفظ الفاتورة بنجاح في قاعدة البيانات المحلية.');

    } catch (error) {
      toast(error.message || 'تعذر حفظ الفاتورة.');
    } finally {
      saving = false;
      button.textContent = 'حفظ الفاتورة في الحسابات';

      if (draft) {
        refresh();
      }
    }
  }

  function init() {
    $('parseInvoiceTextBtn')?.addEventListener('click', parseInvoice);
    $('clearInvoiceTextBtn')?.addEventListener('click', clearImport);
    $('cancelInvoiceImportBtn')?.addEventListener('click', cancelReview);
    $('saveImportedInvoiceBtn')?.addEventListener('click', saveImportedInvoice);

    $('importConfirmMismatch')?.addEventListener('change', () => {
      mismatchApprovedKey = $('importConfirmMismatch').checked
        ? currentMismatchKey()
        : null;
      refresh();
    });

    $('importConfirmDuplicate')?.addEventListener('change', () => {
      duplicateApprovedKey = $('importConfirmDuplicate').checked
        ? currentDuplicateKey()
        : null;
      refresh();
    });

    [
      'importSupplier',
      'importInvoiceNumber',
      'importInvoiceDate',
      'importPrintedTotal',
      'importInvoiceCategory'
    ].forEach(id => {
      $(id)?.addEventListener('change', async () => {
        if (!draft) return;

        if (
          id === 'importInvoiceNumber' ||
          id === 'importSupplier' ||
          id === 'importInvoiceDate'
        ) {
          await checkDuplicates();
        }

        refresh();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
