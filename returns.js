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

  let parsedReturn = null;
  let analysis = null;
  let analysisRun = 0;
  let saving = false;

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

  function validDate(value) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
      return false;
    }

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function isBlank(value) {
    return value === undefined ||
      value === null ||
      String(value).trim() === '';
  }

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

  function normalizeName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[\s\-_.,()\[\]\/+&'"]+/g, '')
      .trim();
  }

  function normalizeBatch(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[\s\-_.\/]+/g, '');
  }

  function categoryName(category) {
    return category === 'medicine'
      ? 'الأدوية'
      : 'المواد العامة';
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

  function parseReturnText(text) {
    if (!text.includes('PHARMACY_RETURN_DATA_V1')) {
      throw new Error(
        'صيغة نص المردود غير صحيحة. يجب أن يبدأ النص بـ PHARMACY_RETURN_DATA_V1.'
      );
    }

    if (!text.includes('[END_RETURN]')) {
      throw new Error(
        'النص غير مكتمل: لم يُعثر على [END_RETURN]. انسخ النص كاملاً وأعد اللصق.'
      );
    }

    const header = parseFields(
      getSection(text, '[RETURN]', '[ITEMS]')
    );

    const summary = parseFields(
      getSection(text, '[SUMMARY]', '[END_RETURN]')
    );

    const blocks = parseItemBlocks(
      getSection(text, '[ITEMS]', '[SUMMARY]')
    );

    if (!blocks.length) {
      throw new Error('لم يتم العثور على أصناف داخل المردود.');
    }

    return {
      header,
      summary,
      items: blocks.map((data, index) => ({
        name: String(data.item_name || '').trim(),
        batch: String(data.batch_number || '').trim(),
        quantityText: data.quantity,
        unitPriceText: data.unit_price,
        lineTotalText: data.line_total,
        rowNumber: data.row_number || String(index + 1)
      }))
    };
  }

  function buildPanel() {
    const page = $('page-return');

    if (!page || $('returnTextPanel')) return;

    const anchor = page.querySelector('.panel');
    const panel = document.createElement('div');

    panel.id = 'returnTextPanel';
    panel.className = 'panel';

    panel.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">مردود بالنص</span>
          <h2>لصق نص المردود</h2>
          <p>اختر الفئة والتاريخ، ثم الصق النص. لا حاجة لاختيار فاتورة</p>
        </div>
      </div>
      <div class="field">
        <label for="returnTextInput">نص المردود</label>
        <textarea id="returnTextInput" rows="10" dir="auto" placeholder="PHARMACY_RETURN_DATA_V1"></textarea>
      </div>
      <div class="import-input-actions">
        <button id="parseReturnTextBtn" class="primary-button full-button" type="button">تحليل المردود</button>
        <button id="clearReturnTextBtn" class="text-button full-button" type="button">مسح النص</button>
      </div>
      <div id="returnTextError" class="message-box error-message" role="alert" hidden></div>
      <div id="returnTextReview" hidden>
        <div class="balance-row"><span>عدد الأصناف</span><strong id="returnTextItemsCount">0</strong></div>
        <div class="balance-row"><span>مجموع المردود</span><strong id="returnTextTotal">0 د.ع</strong></div>
        <div class="balance-row"><span>الحد المتاح للفئة</span><strong id="returnTextCapacity">0 د.ع</strong></div>
        <div id="returnTextRows" class="record-list"></div>
        <div id="returnTextMessages"></div>
        <button id="saveReturnTextBtn" class="primary-button full-button" type="button" disabled>حفظ المردود من النص</button>
      </div>
    `;

    page.insertBefore(panel, anchor);

    const textarea = $('returnTextInput');

    if (textarea) {
      textarea.setAttribute(
        'style',
        'width:100%;min-height:200px;padding:10px 12px;border:1px solid var(--line);' +
        'border-radius:13px;background:var(--surface-solid);color:var(--text);' +
        'font-size:13px;line-height:1.8;resize:vertical;outline:none;font-family:inherit;'
      );
    }
  }

  function showTextError(message) {
    const element = $('returnTextError');

    if (!element) return;

    element.textContent = message;
    element.hidden = false;
  }

  function hideTextError() {
    const element = $('returnTextError');

    if (element) {
      element.textContent = '';
      element.hidden = true;
    }
  }

  function showReview() {
    const element = $('returnTextReview');
    if (element) element.hidden = false;
  }

  function hideReview() {
    const element = $('returnTextReview');
    if (element) element.hidden = true;
  }

  function renderAnalysis(result) {
    const rowsBox = $('returnTextRows');
    const messagesBox = $('returnTextMessages');
    const saveButton = $('saveReturnTextBtn');

    if (!rowsBox || !messagesBox || !saveButton) return;

    $('returnTextItemsCount').textContent = String(result.rows.length);
    $('returnTextTotal').textContent = money(result.total) + ' د.ع';
    $('returnTextCapacity').textContent = money(result.capacity) + ' د.ع';

    rowsBox.replaceChildren();

    result.rows.forEach((row, index) => {
      const card = document.createElement('article');
      card.className = 'record-card';

      const head = document.createElement('div');
      head.className = 'record-card-head';

      const title = document.createElement('strong');
      title.textContent =
        (row.ok ? '✓ ' : '⚠ ') + (index + 1) + '. ' + row.matchedName;

      const amount = document.createElement('strong');
      amount.className = 'record-value';
      amount.textContent = row.lineTotal === null
        ? 'غير محسوبة'
        : money(row.lineTotal) + ' د.ع';

      head.append(title, amount);

      const meta = document.createElement('div');
      meta.className = 'record-meta';

      const sources = row.allocations.length
        ? row.allocations
          .map(a => 'فاتورة ' + a.invoiceNumber + ' × ' + a.qty)
          .join('، ')
        : 'لا توجد فاتورة مطابقة';

      meta.textContent =
        'كمية ' + (row.quantity ?? '—') +
        ' · سعر ' + (row.unitPrice === null ? '—' : money(row.unitPrice)) +
        ' · تشغيلة ' + (row.batch || 'غير مكتوبة') +
        ' · من: ' + sources;

      card.append(head, meta);
      rowsBox.append(card);
    });

    messagesBox.replaceChildren();

    if (result.errors.length) {
      result.errors.forEach(message => {
        const p = document.createElement('p');
        p.className = 'message-box error-message';
        p.textContent = message;
        messagesBox.append(p);
      });
    } else {
      const p = document.createElement('p');
      p.className = 'info-strip';
      p.textContent = 'المردود مطابق للفواتير المحفوظة، ويمكن حفظه.';
      messagesBox.append(p);
    }

    saveButton.disabled =
      saving ||
      result.errors.length > 0 ||
      result.total <= 0;
  }

  async function calculateCapacity(category, invoiceId = null) {
    if (!CATEGORIES.includes(category)) {
      throw new Error('فئة المردود غير صحيحة.');
    }

    const [invoices, returns] = await Promise.all([
      window.PharmacyDB.getAll('invoices'),
      window.PharmacyDB.getAll('returns')
    ]);

    const categoryInvoices = invoices.filter(
      invoice => invoice.category === category
    );

    const categoryPurchased = round(
      categoryInvoices.reduce(
        (sum, invoice) => sum + Number(invoice.total || 0),
        0
      )
    );

    const categoryReturned = round(
      returns
        .filter(item => item.category === category)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );

    const categoryCapacity = Math.max(
      0,
      round(categoryPurchased - categoryReturned)
    );

    if (!invoiceId) {
      return categoryCapacity;
    }

    const selectedInvoice = categoryInvoices.find(
      invoice => String(invoice.id) === String(invoiceId)
    );

    if (!selectedInvoice) {
      return 0;
    }

    const invoiceReturned = round(
      returns
        .filter(item =>
          item.category === category &&
          String(item.invoiceId) === String(invoiceId)
        )
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
    );

    const invoiceCapacity = Math.max(
      0,
      round(Number(selectedInvoice.total || 0) - invoiceReturned)
    );

    return Math.min(invoiceCapacity, categoryCapacity);
  }

  // كل صنف في فواتير الفئة مع الكمية المرتجعة منه سابقاً.
  // المفتاح lineKey = رقم الفاتورة + ":" + ترتيب الصنف داخلها.
  function buildInvoiceLines(invoices, returns, category) {
    const returnedMap = new Map();

    returns
      .filter(record => record.category === category)
      .forEach(record => {
        (Array.isArray(record.items) ? record.items : []).forEach(item => {
          (Array.isArray(item.allocations) ? item.allocations : [])
            .forEach(alloc => {
              returnedMap.set(
                alloc.lineKey,
                (returnedMap.get(alloc.lineKey) || 0) +
                (Number(alloc.qty) || 0)
              );
            });
        });
      });

    const lines = [];

    invoices
      .filter(invoice => invoice.category === category)
      .sort((a, b) =>
        String(a.date).localeCompare(String(b.date)) ||
        Number(a.id) - Number(b.id)
      )
      .forEach(invoice => {
        (Array.isArray(invoice.items) ? invoice.items : [])
          .forEach((item, index) => {
            const lineKey = invoice.id + ':' + index;

            lines.push({
              lineKey,
              invoiceId: invoice.id,
              invoiceNumber: invoice.number || ('#' + invoice.id),
              name: String(item.name || ''),
              nameKey: normalizeName(item.name),
              batch: String(item.batchNumber || ''),
              unitPrice: Number(item.unitPrice) || 0,
              paidQty: Number(item.paidQty) || 0,
              returnedQty: returnedMap.get(lineKey) || 0
            });
          });
      });

    return lines;
  }

  async function analyze() {
    const run = ++analysisRun;

    const category = $('returnType')?.value;
    const date = $('returnDate')?.value;

    const [invoices, returns] = await Promise.all([
      window.PharmacyDB.getAll('invoices'),
      window.PharmacyDB.getAll('returns')
    ]);

    if (run !== analysisRun) return null;

    const errors = [];
    const rows = [];

    if (!CATEGORIES.includes(category)) {
      errors.push('اختر فئة المردود.');
    }

    if (!validDate(date)) {
      errors.push('اختر تاريخ المردود بصورة صحيحة.');
    }

    const headerNumber = String(
      parsedReturn.header.return_number || ''
    ).trim();

    if (!headerNumber) {
      errors.push('رقم مستند المردود غير موجود في النص.');
    }

    if (
      headerNumber &&
      returns.some(item =>
        item.source === 'text-import' &&
        String(item.number || '').trim() === headerNumber
      )
    ) {
      errors.push('هذا المردود مسجل سابقاً برقم المستند نفسه.');
    }

    const lines = CATEGORIES.includes(category)
      ? buildInvoiceLines(invoices, returns, category)
      : [];

    if (CATEGORIES.includes(category) && !lines.length) {
      errors.push('لا توجد فواتير محفوظة في هذه الفئة للمطابقة.');
    }

    // كميات خصمناها في هذه المراجعة نفسها (لمنع تكرار الكمية داخل النص).
    const used = new Map();

    parsedReturn.items.forEach((line, index) => {
      const label =
        'السطر ' + (index + 1) + ' (' + (line.name || 'بدون اسم') + ')';

      const rowErrors = [];

      const key = normalizeName(line.name);
      const quantity = numberValue(line.quantityText);
      const priceText = numberValue(line.unitPriceText);
      const totalText = numberValue(line.lineTotalText);
      const batchKey = normalizeBatch(line.batch);

      if (!key) {
        rowErrors.push('اسم الصنف مطلوب.');
      }

      if (
        quantity === null ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        rowErrors.push('الكمية غير صحيحة.');
      }

      if (priceText !== null && priceText < 0) {
        rowErrors.push('سعر الوحدة غير صحيح.');
      }

      if (totalText === null || totalText < 0) {
        rowErrors.push('قيمة السطر غير موجودة.');
      }

      let candidates = [];

      if (key) {
        candidates = lines.filter(l => l.nameKey === key);

        if (!candidates.length) {
          candidates = lines.filter(l =>
            key.length >= 6 &&
            l.nameKey.length >= 6 &&
            (l.nameKey.includes(key) || key.includes(l.nameKey))
          );
        }

        if (batchKey && candidates.length) {
          const byBatch = candidates.filter(
            l => normalizeBatch(l.batch) === batchKey
          );

          if (byBatch.length) {
            candidates = byBatch;
          } else {
            rowErrors.push(
              'التشغيلة (' + line.batch +
              ') لا تطابق أي فاتورة محفوظة لهذا الصنف.'
            );
          }
        }

        if (priceText !== null && candidates.length) {
          const byPrice = candidates.filter(
            l => Math.abs(l.unitPrice - priceText) <= 0.01
          );

          if (byPrice.length) {
            candidates = byPrice;
          } else {
            rowErrors.push(
              'سعر الوحدة (' + money(priceText) +
              ') لا يطابق أي فاتورة محفوظة لهذا الصنف.'
            );
          }
        }

        if (!candidates.length) {
          rowErrors.push('الصنف غير موجود في فواتير هذه الفئة.');
        }
      }

      const available = candidates.reduce(
        (sum, l) =>
          sum + Math.max(
            0,
            l.paidQty - l.returnedQty - (used.get(l.lineKey) || 0)
          ),
        0
      );

      const allocations = [];

      if (
        quantity !== null &&
        quantity > 0 &&
        candidates.length
      ) {
        if (quantity > available) {
          rowErrors.push(
            'الكمية المرتجعة (' + quantity +
            ') تتجاوز المتاح من هذا الصنف (' + available + ').'
          );
        } else {
          let need = quantity;

          for (const l of candidates) {
            if (need <= 0) break;

            const remaining = Math.max(
              0,
              l.paidQty - l.returnedQty - (used.get(l.lineKey) || 0)
            );

            const take = Math.min(remaining, need);

            if (take > 0) {
              used.set(
                l.lineKey,
                (used.get(l.lineKey) || 0) + take
              );

              allocations.push({
                lineKey: l.lineKey,
                invoiceId: l.invoiceId,
                invoiceNumber: l.invoiceNumber,
                qty: take,
                unitPrice: l.unitPrice
              });

              need -= take;
            }
          }
        }
      }

      const unitPrice = priceText !== null
        ? priceText
        : (allocations.length ? allocations[0].unitPrice : null);

      const computed = quantity !== null && unitPrice !== null
        ? round(quantity * unitPrice)
        : null;

      if (
        computed !== null &&
        totalText !== null &&
        Math.abs(computed - totalText) > 0.02
      ) {
        rowErrors.push('القيمة المطبوعة لا تساوي الكمية × السعر.');
      }

      rows.push({
        matchedName: candidates.length
          ? candidates[0].name
          : line.name,
        batch: line.batch,
        quantity,
        unitPrice,
        lineTotal: computed,
        allocations,
        ok: rowErrors.length === 0
      });

      rowErrors.forEach(message => {
        errors.push(label + ': ' + message);
      });
    });

    const total = round(
      rows.reduce(
        (sum, row) => sum + (row.lineTotal === null ? 0 : row.lineTotal),
        0
      )
    );

    const printed = numberValue(parsedReturn.header.printed_total);

    if (printed === null) {
      errors.push('الإجمالي المطبوع غير موجود في النص.');
    } else if (Math.abs(printed - total) > 0.02) {
      errors.push(
        'مجموع أصناف المردود (' + money(total) +
        ') لا يطابق الإجمالي المطبوع (' + money(printed) + ').'
      );
    }

    const summaryCount = numberValue(parsedReturn.summary.items_count);

    if (summaryCount !== null && summaryCount !== rows.length) {
      errors.push('عدد الأصناف لا يطابق الملخص.');
    }

    let capacity = 0;

    if (CATEGORIES.includes(category)) {
      capacity = await calculateCapacity(category);

      if (run !== analysisRun) return null;

      if (total > capacity) {
        errors.push(
          'قيمة المردود (' + money(total) +
          ') تتجاوز الحد المتاح للفئة (' + money(capacity) + ').'
        );
      }
    }

    return {
      errors,
      rows,
      total,
      capacity,
      category,
      date,
      headerNumber
    };
  }

  async function revalidate() {
    if (!parsedReturn) {
      analysis = null;
      hideReview();
      return;
    }

    try {
      const result = await analyze();

      if (!result) return;

      analysis = result;
      renderAnalysis(result);
      showReview();
    } catch (error) {
      showTextError(error.message || 'تعذر التحقق من المردود.');
    }
  }

  function clearText() {
    const input = $('returnTextInput');

    if (input) input.value = '';

    parsedReturn = null;
    analysis = null;

    hideTextError();
    hideReview();
  }

  async function parseText() {
    hideTextError();

    const text = String($('returnTextInput')?.value || '').trim();

    if (!text) {
      showTextError('الصق نص المردود أولاً.');
      return;
    }

    try {
      parsedReturn = parseReturnText(text);
    } catch (error) {
      parsedReturn = null;
      analysis = null;
      hideReview();
      showTextError(error.message || 'تعذر تحليل نص المردود.');
      return;
    }

    await revalidate();
  }

  async function saveText() {
    if (saving || !analysis || analysis.errors.length) {
      toast('راجع الأخطاء قبل حفظ المردود.');
      return;
    }

    const button = $('saveReturnTextBtn');

    saving = true;

    if (button) {
      button.disabled = true;
      button.textContent = 'جارٍ الحفظ...';
    }

    try {
      const preparedBy = parsedReturn.header.prepared_by
        ? 'المجهز: ' + parsedReturn.header.prepared_by
        : '';

      const extraNotes = String($('returnNotes')?.value || '').trim();

      const record = {
        category: analysis.category,
        date: analysis.date,
        month: analysis.date.slice(0, 7),
        invoiceId: null,
        amount: analysis.total,
        number: analysis.headerNumber,
        notes: [
          'مردود مستورد من نص',
          preparedBy,
          extraNotes
        ].filter(Boolean).join(' · '),
        items: analysis.rows.map(row => ({
          name: row.matchedName,
          batch: row.batch,
          qty: row.quantity,
          unitPrice: row.unitPrice,
          lineTotal: row.lineTotal,
          allocations: row.allocations
        })),
        source: 'text-import',
        createdAt: new Date().toISOString()
      };

      await window.PharmacyDB.add('returns', record);

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'return-import' }
        })
      );

      clearText();

      if ($('returnNotes')) {
        $('returnNotes').value = '';
      }

      toast('تم تسجيل المردود بنجاح.');

      await updateCapacity();
    } catch (error) {
      toast(error.message || 'تعذر حفظ المردود.');
    } finally {
      saving = false;

      if (button) {
        button.textContent = 'حفظ المردود من النص';
        button.disabled = !analysis || analysis.errors.length > 0;
      }
    }
  }

  async function renderInvoices() {
    const select = $('returnInvoice');
    if (!select) return;

    const previous = select.value;
    const invoices = await window.PharmacyDB.getAll('invoices');
    const category = $('returnType')?.value;

    select.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'كل فواتير الفئة';
    select.append(placeholder);

    invoices
      .filter(invoice => invoice.category === category)
      .sort((a, b) =>
        String(b.date).localeCompare(String(a.date))
      )
      .forEach(invoice => {
        const option = document.createElement('option');

        option.value = String(invoice.id);
        option.textContent =
          (invoice.number
            ? 'فاتورة ' + invoice.number
            : 'فاتورة #' + invoice.id) +
          ' — ' + invoice.date +
          ' — ' + money(invoice.total) + ' د.ع';

        select.append(option);
      });

    if (
      [...select.options].some(
        option => option.value === previous
      )
    ) {
      select.value = previous;
    }

    await updateCapacity();
    await revalidate();
  }

  async function updateCapacity() {
    const info = $('returnCapacityInfo');
    if (!info) return;

    try {
      const category = $('returnType')?.value;
      const invoiceId = $('returnInvoice')?.value || null;

      const capacity = await calculateCapacity(category, invoiceId);

      info.textContent =
        'الحد المتاح للمردود في ' +
        categoryName(category) +
        ': ' + money(capacity) + ' د.ع';
    } catch (error) {
      info.textContent =
        error.message || 'تعذر حساب الحد المتاح.';
    }
  }

  async function saveReturn() {
    const category = $('returnType')?.value;
    const date = $('returnDate')?.value;
    const amount = round(Number($('returnAmount')?.value));
    const invoiceValue = $('returnInvoice')?.value || '';

    const invoiceId = invoiceValue
      ? Number(invoiceValue)
      : null;

    if (!CATEGORIES.includes(category)) {
      toast('اختر فئة المردود.');
      return;
    }

    if (!validDate(date)) {
      toast('اختر تاريخ المردود بصورة صحيحة.');
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast('أدخل قيمة مردود صحيحة أكبر من صفر.');
      return;
    }

    if (
      invoiceId !== null &&
      (!Number.isSafeInteger(invoiceId) || invoiceId <= 0)
    ) {
      toast('الفاتورة المختارة غير صحيحة.');
      return;
    }

    const button = $('saveReturnBtn');

    if (button?.disabled) return;
    if (button) button.disabled = true;

    try {
      const capacity = await calculateCapacity(category, invoiceId);

      if (amount > capacity) {
        toast(
          'قيمة المردود تتجاوز الحد المتاح (' +
          money(capacity) + ' د.ع).'
        );
        return;
      }

      const record = {
        category,
        date,
        month: date.slice(0, 7),
        invoiceId,
        amount,
        number: String($('returnNumber')?.value || '').trim(),
        notes: String($('returnNotes')?.value || '').trim(),
        items: [],
        source: 'manual',
        createdAt: new Date().toISOString()
      };

      await window.PharmacyDB.add('returns', record);

      $('returnAmount').value = '';

      if ($('returnNumber')) {
        $('returnNumber').value = '';
      }

      if ($('returnNotes')) {
        $('returnNotes').value = '';
      }

      toast('تم تسجيل المردود بنجاح.');

      document.dispatchEvent(
        new CustomEvent('pharmacy:data-changed', {
          detail: { type: 'return' }
        })
      );

      await updateCapacity();
      await revalidate();
    } catch (error) {
      toast(error.message || 'تعذر تسجيل المردود.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function init() {
    if (!$('returnDate')) return;

    if (!$('returnDate').value) {
      $('returnDate').value = today();
    }

    buildPanel();

    $('returnType')?.addEventListener('change', renderInvoices);
    $('returnInvoice')?.addEventListener('change', updateCapacity);
    $('returnDate')?.addEventListener('change', revalidate);

    $('saveReturnBtn')?.addEventListener('click', saveReturn);

    $('parseReturnTextBtn')?.addEventListener('click', parseText);

    $('clearReturnTextBtn')?.addEventListener('click', () => {
      if (!saving) clearText();
    });

    $('saveReturnTextBtn')?.addEventListener('click', saveText);

    renderInvoices();
  }

  window.PharmacyReturns = Object.freeze({
    init,
    calculateCapacity,
    refresh: renderInvoices
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
