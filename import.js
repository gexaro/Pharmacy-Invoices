
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const money = value =>
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2
    }).format(Number(value) || 0);

  const round = value =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  let draft = null;
  let items = [];
  let validationErrors = [];
  let validationWarnings = [];
  let duplicateFound = false;
  let saving = false;

  function toast(message) {
    if (window.PharmacyApp?.toast) {
      window.PharmacyApp.toast(message);
    } else {
      alert(message);
    }
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

  function numberValue(value) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const normalized = String(value)
      .replace(/,/g, '')
      .replace(/[٬]/g, '')
      .trim();

    if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
      return null;
    }

    const number = Number(normalized);

    return Number.isFinite(number) ? number : null;
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

      blocks.push(
        parseFields(text.slice(start, end))
      );

      regex.lastIndex = end + 'END_ITEM'.length;
    }

    return blocks;
  }

  function prepareItem(data, index) {
    const name = String(data.item_name || '').trim();

    const paidQty = numberValue(data.paid_quantity);
    const bonusQty = numberValue(data.bonus_quantity);
    const receivedQty = numberValue(data.total_received_quantity);
    const unitPrice = numberValue(data.unit_price);
    const itemTotal = numberValue(data.line_total);
    const actualUnitCost = numberValue(data.actual_unit_cost);

    const errors = [];

    if (!name) {
      errors.push('اسم الصنف غير موجود.');
    }

    if (
      paidQty === null ||
      !Number.isSafeInteger(paidQty) ||
      paidQty <= 0
    ) {
      errors.push('الكمية المدفوعة غير صحيحة.');
    }

    if (
      bonusQty === null ||
      !Number.isSafeInteger(bonusQty) ||
      bonusQty < 0
    ) {
      errors.push('كمية البونص غير صحيحة.');
    }

    if (
      receivedQty === null ||
      !Number.isSafeInteger(receivedQty) ||
      receivedQty < 0
    ) {
      errors.push('الكمية المستلمة غير صحيحة.');
    }

    if (
      paidQty !== null &&
      bonusQty !== null &&
      receivedQty !== null &&
      paidQty + bonusQty !== receivedQty
    ) {
      errors.push('الكمية المستلمة لا تساوي المدفوع + البونص.');
    }

    if (
      unitPrice === null ||
      unitPrice < 0
    ) {
      errors.push('سعر الوحدة غير صحيح.');
    }

    if (
      itemTotal === null ||
      itemTotal < 0
    ) {
      errors.push('قيمة السطر غير موجودة أو غير صحيحة.');
    }

    if (
      actualUnitCost !== null &&
      actualUnitCost < 0
    ) {
      errors.push('التكلفة الفعلية غير صحيحة.');
    }

    const calculatedTotal =
      paidQty !== null && unitPrice !== null
        ? round(paidQty * unitPrice)
        : null;

    if (
      calculatedTotal !== null &&
      itemTotal !== null &&
      Math.abs(calculatedTotal - itemTotal) > 0.02
    ) {
      errors.push('قيمة السطر لا تطابق الكمية المدفوعة × السعر.');
    }

    return {
      name,
      paidQty,
      bonusQty,
      receivedQty,
      unitPrice,
      itemTotal,
      effectiveUnitCost: actualUnitCost,
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
      errors,
      sourceIndex: index
    };
  }

  function readInvoice(text) {
    if (!text.includes('PHARMACY_INVOICE_DATA_V1')) {
      throw new Error('صيغة النص غير صحيحة. لم يتم العثور على PHARMACY_INVOICE_DATA_V1.');
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

    const preparedItems = itemBlocks.map(prepareItem);

    const firstCategory = itemBlocks.find(
      item => ['medicine', 'general'].includes(item.category)
    )?.category || 'medicine';

    return {
      header,
      summary,
      duplicate,
      uncertain,
      items: preparedItems,
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

  function addValidation(message, type = 'error') {
    if (type === 'error') {
      validationErrors.push(message);
    } else {
      validationWarnings.push(message);
    }
  }

  function validateDraft() {
    validationErrors = [];
    validationWarnings = [];

    const h = draft.header;

    if (!String($('importSupplier')?.value || '').trim()) {
      addValidation('اسم المورد غير موجود.');
    }

    if (!String($('importInvoiceNumber')?.value || '').trim()) {
      addValidation('رقم الفاتورة غير موجود.');
    }

    if (!dateValue($('importInvoiceDate')?.value)) {
      addValidation('تاريخ الفاتورة غير صحيح.');
    }

    const category = $('importInvoiceCategory')?.value;

    if (!['medicine', 'general'].includes(category)) {
      addValidation('اختر فئة الفاتورة.');
    }

    if (!items.length) {
      addValidation('لا توجد أصناف.');
    }

    items.forEach((item, index) => {
      item.errors = [];

      if (!item.name.trim()) {
        item.errors.push('اسم الصنف مطلوب.');
      }

      if (
        !Number.isSafeInteger(Number(item.paidQty)) ||
        Number(item.paidQty) <= 0
      ) {
        item.errors.push('الكمية المدفوعة غير صحيحة.');
      }

      if (
        !Number.isSafeInteger(Number(item.bonusQty)) ||
        Number(item.bonusQty) < 0
      ) {
        item.errors.push('كمية البونص غير صحيحة.');
      }

      if (
        Number(item.receivedQty) !==
        Number(item.paidQty) + Number(item.bonusQty)
      ) {
        item.errors.push('الكمية المستلمة غير متطابقة.');
      }

      if (
        !Number.isFinite(Number(item.unitPrice)) ||
        Number(item.unitPrice) < 0
      ) {
        item.errors.push('سعر الوحدة غير صحيح.');
      }

      if (
        !Number.isFinite(Number(item.itemTotal)) ||
        Number(item.itemTotal) < 0
      ) {
        item.errors.push('قيمة السطر غير صحيحة.');
      }

      const calculated = round(
        Number(item.paidQty) * Number(item.unitPrice)
      );

      if (
        Number.isFinite(calculated) &&
        Math.abs(calculated - Number(item.itemTotal)) > 0.02
      ) {
        item.errors.push('قيمة السطر لا تطابق الحساب.');
      }

      if (item.errors.length) {
        addValidation(
          'الصنف ' + (index + 1) + ' (' + item.name + '): ' +
          item.errors.join(' ')
        );
      }

      if (
        item.sourceCategory &&
        item.sourceCategory !== $('importInvoiceCategory')?.value
      ) {
        addValidation(
          'تصنيف الصنف ' + item.name +
          ' لا يطابق فئة الفاتورة المختارة.'
        );
      }

      if (
        item.confidence &&
        item.confidence.toUpperCase() !== 'HIGH'
      ) {
        addValidation(
          'ثقة استخراج الصنف ' + item.name +
          ' ليست HIGH. راجعه يدوياً.',
          'warning'
        );
      }
    });

    const pages = numberValue(h.page_count);

    if (pages !== null && pages > 1) {
      const foundPages = new Set(
        items
          .map(item => item.pageNumber)
          .filter(value => Number.isInteger(value) && value > 0)
      );

      if (foundPages.size < pages) {
        addValidation(
          'الفاتورة تشير إلى ' + pages +
          ' صفحات، لكن النص لا يحتوي على أصناف من جميع الصفحات.'
        );
      }
    }

    const printed = numberValue($('importPrintedTotal')?.value);

    if (printed === null) {
      addValidation(
        'الإجمالي المطبوع غير متوفر. لا يمكن إتمام الحفظ دون مراجعته.'
      );
    }

    if (
      printed !== null &&
      Math.abs(printed - calculateTotal()) > 0.02
    ) {
      addValidation(
        'الإجمالي المحسوب لا يطابق الإجمالي المطبوع. راجع الفرق وأكد ذلك.'
      );
    }

    const summaryCount = numberValue(draft.summary.items_count);

    if (
      summaryCount !== null &&
      summaryCount !== items.length
    ) {
      addValidation(
        'عدد الأصناف لا يطابق العدد المذكور في الملخص.'
      );
    }

    const summaryTotal = numberValue(
      draft.summary.sum_of_line_totals
    );

    if (
      summaryTotal !== null &&
      Math.abs(summaryTotal - calculateTotal()) > 0.02
    ) {
      addValidation(
        'مجموع قيم الأصناف لا يطابق مجموع الأصناف المذكور في الملخص.'
      );
    }

    if (
      draft.duplicate.duplicate_status &&
      draft.duplicate.duplicate_status.toUpperCase() !== 'NONE'
    ) {
      addValidation(
        'بيانات النص تشير إلى احتمال وجود نسخة مكررة.',
        'warning'
      );
    }

    if (
      draft.duplicate.requires_manual_confirmation === 'YES'
    ) {
      addValidation(
        'النص يتطلب تأكيداً يدوياً بشأن التكرار.',
        'warning'
      );
    }

    if (draft.uncertain.trim()) {
      addValidation(
        'توجد بيانات غير مؤكدة في النص الأصلي. راجعها قبل الحفظ.',
        'warning'
      );
    }

    if (duplicateFound) {
      addValidation(
        'وجدت فاتورة سابقة برقم مشابه. يلزم تأكيد أنها فاتورة مستقلة.',
        'warning'
      );
    }

    if (validationErrors.length === 0 && validationWarnings.length === 0) {
      addValidation('اجتازت الفاتورة الفحص الأولي.', 'success');
    }
  }

  function calculateTotal() {
    return round(
      items.reduce(
        (sum, item) => sum + Number(item.itemTotal || 0),
        0
      )
    );
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
      updateReview();
    });

    wrapper.append(label, input);

    return wrapper;
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
      title.textContent = (index + 1) + '. ' + item.name;

      const badge = document.createElement('span');
      badge.className = 'count-badge';
      badge.textContent = item.bonusQty > 0 ? 'يتضمن بونص' : 'صنف';

      heading.append(title, badge);

      const fields = document.createElement('div');
      fields.className = 'form-grid';

      fields.append(
        createItemField('اسم الصنف', item.name, value => {
          item.name = value;
        }),
        createItemField('الكمية المدفوعة', item.paidQty, value => {
          item.paidQty = numberValue(value);
        }, 'number'),
        createItemField('كمية البونص', item.bonusQty, value => {
          item.bonusQty = numberValue(value);
        }, 'number'),
        createItemField('الكمية المستلمة', item.receivedQty, value => {
          item.receivedQty = numberValue(value);
        }, 'number'),
        createItemField('سعر الوحدة', item.unitPrice, value => {
          item.unitPrice = numberValue(value);
        }, 'number'),
        createItemField('قيمة السطر', item.itemTotal, value => {
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
        ' · الصلاحية: ' + (item.expiryDate || 'غير متوفرة');

      const note = document.createElement('p');
      note.className = 'hint-text';
      note.textContent = item.notes || '';

      card.append(heading, fields, details, batch, note);
      container.append(card);
    });

    $('importItemCount').textContent = String(items.length);
  }

  function renderMessages() {
    const container = $('importValidationMessages');

    if (!container) return;

    container.replaceChildren();

    const all = [
      ...validationErrors.map(message => ({
        message,
        type: 'error'
      })),
      ...validationWarnings.map(message => ({
        message,
        type: 'warning'
      }))
    ];

    all.forEach(entry => {
      const row = document.createElement('p');
      row.className = 'message-box ' +
        (entry.type === 'error' ? 'error-message' : 'info-strip');
      row.textContent = entry.message;
      container.append(row);
    });

    const mismatch =
      validationErrors.some(message =>
        message.includes('الإجمالي المحسوب')
      );

    const mismatchRow = $('importMismatchConfirmRow');
    const mismatchCheck = $('importConfirmMismatch');

    mismatchRow.hidden = !mismatch;

    if (!mismatch) {
      mismatchCheck.checked = false;
    }

    const duplicateRow = $('importDuplicateConfirmRow');
    const duplicateCheck = $('importConfirmDuplicate');

    duplicateRow.hidden = !duplicateFound &&
      draft.duplicate.duplicate_status.toUpperCase() === 'NONE' &&
      draft.duplicate.requires_manual_confirmation !== 'YES';

    if (duplicateRow.hidden) {
      duplicateCheck.checked = false;
    }
  }

  function updateReview() {
    validateDraft();

    const total = calculateTotal();
    const paid = items.reduce(
      (sum, item) => sum + Number(item.paidQty || 0),
      0
    );
    const bonus = items.reduce(
      (sum, item) => sum + Number(item.bonusQty || 0),
      0
    );
    const received = items.reduce(
      (sum, item) => sum + Number(item.receivedQty || 0),
      0
    );

    const printed = numberValue($('importPrintedTotal')?.value);

    $('importSummaryItems').textContent = String(items.length);
    $('importSummaryPaid').textContent = String(paid);
    $('importSummaryBonus').textContent = String(bonus);
    $('importSummaryReceived').textContent = String(received);
    $('importSummaryCalculated').textContent = money(total) + ' د.ع';

    $('importSummaryPrinted').textContent =
      printed === null ? 'غير متوفر' : money(printed) + ' د.ع';

    $('importSummaryDifference').textContent =
      printed === null
        ? 'غير قابل للتحقق'
        : money(round(printed - total)) + ' د.ع';

    renderMessages();

    const mismatch = validationErrors.some(message =>
      message.includes('الإجمالي المحسوب')
    );

    const duplicateNeedsConfirmation =
      !$('importDuplicateConfirmRow').hidden;

    const mismatchApproved =
      !mismatch || $('importConfirmMismatch').checked;

    const duplicateApproved =
      !duplicateNeedsConfirmation ||
      $('importConfirmDuplicate').checked;

    const onlyConfirmableErrors =
      validationErrors.every(message =>
        message.includes('الإجمالي المحسوب')
      );

    $('saveImportedInvoiceBtn').disabled =
      saving ||
      (!onlyConfirmableErrors && validationErrors.length > 0) ||
      !mismatchApproved ||
      !duplicateApproved;
  }

  async function checkDuplicates() {
    duplicateFound = false;

    const number = String(
      $('importInvoiceNumber')?.value || ''
    ).trim();

    if (!number || !window.PharmacyDB) return;

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

      const sameDate =
        !date || invoice.date === date;

      return sameSupplier && sameDate;
    });
  }

  function showHeaderWarnings() {
    const element = $('importHeaderWarnings');
    const h = draft.header;

    const warnings = [];

    if (!h.box_count) {
      warnings.push('عدد الصناديق غير متوفر.');
    }

    if (!h.previous_balance) {
      warnings.push('الرصيد السابق غير متوفر.');
    }

    if (draft.uncertain.trim()) {
      warnings.push('توجد ملاحظات وبيانات غير مؤكدة في النص الأصلي.');
    }

    element.textContent = warnings.join(' ');
    element.hidden = warnings.length === 0;
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

      fillHeader();
      showHeaderWarnings();
      renderItems();

      await checkDuplicates();

      updateReview();
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

    $('importConfirmMismatch').checked = false;
    $('importConfirmDuplicate').checked = false;
  }

  function cancelReview() {
    if (saving) return;

    hideReview();

    draft = null;
    items = [];
    duplicateFound = false;

    toast('تم إلغاء المراجعة. لم يتم حفظ أي بيانات.');
  }

  async function saveImportedInvoice() {
    if (!draft || saving) return;

    updateReview();

    if ($('saveImportedInvoiceBtn').disabled) {
      toast('راجع الأخطاء والتأكيدات المطلوبة قبل الحفظ.');
      return;
    }

    const button = $('saveImportedInvoiceBtn');

    saving = true;
    button.disabled = true;
    button.textContent = 'جارٍ الحفظ...';

    try {
      const date = dateValue(
        $('importInvoiceDate').value
      );

      const category = $('importInvoiceCategory').value;

      const invoiceItems = items.map(item => ({
        name: String(item.name).trim(),
        paidQty: Number(item.paidQty),
        bonusQty: Number(item.bonusQty),
        receivedQty: Number(item.receivedQty),
        unitPrice: Number(item.unitPrice),
        itemTotal: round(Number(item.itemTotal)),
        effectiveUnitCost:
          item.effectiveUnitCost !== null
            ? Number(item.effectiveUnitCost)
            : (
                Number(item.receivedQty) > 0
                  ? round(
                      Number(item.itemTotal) /
                      Number(item.receivedQty)
                    )
                  : 0
              ),
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
      }));

      const total = round(
        invoiceItems.reduce(
          (sum, item) => sum + item.itemTotal,
          0
        )
      );

      const invoice = {
        category,
        number: String($('importInvoiceNumber').value || '').trim(),
        date,
        month: date.slice(0, 7),
        notes: [
          'فاتورة مستوردة من نص منظم.',
          'المورد: ' + $('importSupplier').value,
          'العميل: ' + $('importCustomer').value,
          'المندوب: ' + $('importRepresentative').value,
          'هاتف المندوب: ' + $('importRepresentativePhone').value,
          'نوع الفاتورة: ' + $('importInvoiceType').value
        ].join('\n'),
        supplier: String($('importSupplier').value || '').trim(),
        customer: String($('importCustomer').value || '').trim(),
        representative: String($('importRepresentative').value || '').trim(),
        representativePhone: String(
          $('importRepresentativePhone').value || ''
        ).trim(),
        invoiceType: String($('importInvoiceType').value || '').trim(),
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

      toast('تم حفظ الفاتورة بنجاح في قاعدة البيانات المحلية.');

    } catch (error) {
      toast(error.message || 'تعذر حفظ الفاتورة.');
    } finally {
      saving = false;
      button.textContent = 'حفظ الفاتورة في الحسابات';

      if (draft) {
        updateReview();
      }
    }
  }

  function init() {
    $('parseInvoiceTextBtn')?.addEventListener(
      'click',
      parseInvoice
    );

    $('clearInvoiceTextBtn')?.addEventListener(
      'click',
      clearImport
    );

    $('cancelInvoiceImportBtn')?.addEventListener(
      'click',
      cancelReview
    );

    $('saveImportedInvoiceBtn')?.addEventListener(
      'click',
      saveImportedInvoice
    );

    $('importConfirmMismatch')?.addEventListener(
      'change',
      updateReview
    );

    $('importConfirmDuplicate')?.addEventListener(
      'change',
      updateReview
    );

    [
      'importSupplier',
      'importInvoiceNumber',
      'importInvoiceDate',
      'importPrintedTotal',
      'importInvoiceCategory'
    ].forEach(id => {
      $(id)?.addEventListener('change', async () => {
        if (!draft) return;

        if (id === 'importInvoiceNumber' ||
            id === 'importSupplier' ||
            id === 'importInvoiceDate') {
          await checkDuplicates();
        }

        updateReview();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {
      once: true
    });
  } else {
    init();
  }
})();
