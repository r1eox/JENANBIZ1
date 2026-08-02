const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('../database');
const { authMiddleware } = require('../middleware/authMiddleware');
const { createNotification, notifyAdmins } = require('../services/notificationService');
const { analyzeBankStatement, analyzeDocument } = require('../services/aiService');
const { ensureRequestDocuments } = require('../services/requestDocuments');

const router = express.Router();

function canCreateRequests(user = {}) {
  return user.role === 'admin' || ['employee', 'partner'].includes(user.role) || (user.permissions || []).includes('create_requests');
}

function canDeleteRequests(user = {}) {
  return user.role === 'admin' || (user.permissions || []).includes('delete_requests');
}

// File upload configs
const makeStorage = (subDir) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads', subDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, safeName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf|webp/;
  if (allowed.test(path.extname(file.originalname).toLowerCase().slice(1))) return cb(null, true);
  cb(new Error('نوع الملف غير مدعوم. المسموح: PDF, JPG, PNG, WEBP'));
};

const bankUpload = multer({ storage: makeStorage('bank-statements'), fileFilter, limits: { fileSize: 25 * 1024 * 1024 } });
const docUpload = multer({ storage: makeStorage('documents'), fileFilter, limits: { fileSize: 15 * 1024 * 1024 } });
const completeUpload = multer({ storage: makeStorage('complete-files'), limits: { fileSize: 100 * 1024 * 1024 } });
const contractUpload = multer({ storage: makeStorage('contracts'), limits: { fileSize: 20 * 1024 * 1024 } });
const accountUpload = multer({ storage: makeStorage('account-statements'), fileFilter: (req, file, cb) => {
  const allowed = /xlsx|xls/;
  if (allowed.test(path.extname(file.originalname).toLowerCase().slice(1))) return cb(null, true);
  cb(new Error('نوع الملف غير مدعوم. المسموح: XLSX, XLS'));
}, limits: { fileSize: 25 * 1024 * 1024 } });
const taxUpload = multer({ storage: makeStorage('tax-documents'), fileFilter, limits: { fileSize: 25 * 1024 * 1024 } });
const chatAttachmentUpload = multer({ storage: makeStorage('chat-attachments'), fileFilter: (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf|webp|xlsx|xls|doc|docx/;
  if (allowed.test(path.extname(file.originalname).toLowerCase().slice(1))) return cb(null, true);
  cb(new Error('نوع الملف غير مدعوم. المسموح: PDF, JPG, PNG, WEBP, XLSX, XLS, DOC, DOCX'));
}, limits: { fileSize: 20 * 1024 * 1024 } });

function normalizeText(value = '') {
  return String(value).trim().toLowerCase();
}

function parseRequiredDocuments(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function decodeUploadedFileName(originalName = '') {
  const fallbackName = String(originalName || '').trim();
  if (!fallbackName) return 'file';

  try {
    const decodedName = Buffer.from(fallbackName, 'latin1').toString('utf8').trim();
    if (!decodedName) return fallbackName;
    if (decodedName.includes('�') && !fallbackName.includes('�')) return fallbackName;
    return decodedName;
  } catch (error) {
    return fallbackName;
  }
}

function parseObjectField(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function sanitizeArchiveName(value = '') {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'file';
}

function isZipFile(filePath = '') {
  return path.extname(String(filePath || '')).toLowerCase() === '.zip';
}

function toPublicUploadUrl(filePath = '') {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  const uploadsIndex = normalizedPath.lastIndexOf('/uploads/');
  if (uploadsIndex === -1) return null;
  return `/uploads/${normalizedPath.slice(uploadsIndex + 9)}`;
}

async function createZipArchive(zipPath, entries) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    for (const entry of entries) {
      archive.file(entry.path, { name: entry.name });
    }
    archive.finalize();
  });
}

async function collectRequestPackageEntries(requestId) {
  const [documents, bankStatements, accountStatements, taxDocuments] = await Promise.all([
    db.prepare('SELECT file_path, file_name, document_name FROM request_documents WHERE request_id = ? AND file_path IS NOT NULL ORDER BY id').all(requestId),
    db.prepare('SELECT file_path, file_name FROM bank_statements WHERE request_id = ? AND file_path IS NOT NULL ORDER BY uploaded_at').all(requestId),
    db.prepare('SELECT file_path, file_name FROM account_statements WHERE request_id = ? AND file_path IS NOT NULL ORDER BY uploaded_at').all(requestId),
    db.prepare('SELECT file_path, file_name FROM tax_documents WHERE request_id = ? AND file_path IS NOT NULL ORDER BY uploaded_at').all(requestId),
  ]);

  const entries = [];
  const pushEntries = (items, category) => {
    for (const item of items) {
      if (!item.file_path || !fs.existsSync(item.file_path)) continue;
      entries.push({
        path: item.file_path,
        name: `${category}/${sanitizeArchiveName(item.file_name || item.document_name || path.basename(item.file_path))}`,
      });
    }
  };

  pushEntries(documents, 'المستندات');
  pushEntries(bankStatements, 'الكشوفات البنكية');
  pushEntries(accountStatements, 'القوائم الحسابية');
  pushEntries(taxDocuments, 'الوثائق الضريبية');

  return entries;
}

async function ensureCompletePackage(request) {
  const packageEntries = await collectRequestPackageEntries(request.id);

  if (packageEntries.length === 0) {
    if (request.complete_file_path && fs.existsSync(request.complete_file_path)) {
      return {
        filePath: request.complete_file_path,
        fileName: request.complete_file_name || path.basename(request.complete_file_path),
        created: false,
      };
    }
    return null;
  }

  if (packageEntries.length === 1 && isZipFile(packageEntries[0].path)) {
    return {
      filePath: packageEntries[0].path,
      fileName: packageEntries[0].name,
      created: false,
    };
  }

  const uploadsDir = path.join(__dirname, '../uploads/complete-files');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const zipName = `request-${request.id}-${Date.now()}.zip`;
  const zipPath = path.join(uploadsDir, zipName);
  await createZipArchive(zipPath, packageEntries);

  return {
    filePath: zipPath,
    fileName: zipName,
    created: true,
    entryCount: packageEntries.length,
  };
}

function normalizeApplicantCategory(value = '') {
  const rawValue = String(value || '').trim();
  if (['مالك منشأة', 'صاحب منشأة', 'منشأة'].includes(rawValue)) return 'مالك منشأة';
  if (['موظف', 'موظفة'].includes(rawValue)) return 'موظف';
  if (['فرد', 'فردي', 'فرد مستقل'].includes(rawValue)) return 'فرد';
  return rawValue;
}

function resolveRequestPrimaryName(body = {}, productDetails = {}) {
  const explicitName = String(body.company_name || '').trim();
  if (explicitName) return explicitName;

  const fundingType = String(body.funding_type || '').trim();
  const applicantCategory = normalizeApplicantCategory(productDetails.applicant_category);

  if (fundingType === 'تمويل شخصي') {
    return String(productDetails.employee_name || body.owner_name || '').trim();
  }

  if (['عقار', 'رهن'].includes(fundingType)) {
    if (applicantCategory === 'مالك منشأة') {
      return String(productDetails.business_name || body.owner_name || '').trim();
    }
    return String(productDetails.applicant_name || productDetails.employee_name || body.owner_name || '').trim();
  }

  return String(productDetails.business_name || body.owner_name || '').trim();
}

function resolveOwnerName(body = {}, productDetails = {}) {
  const explicitOwner = String(body.owner_name || '').trim();
  if (explicitOwner) return explicitOwner;

  const fundingType = String(body.funding_type || '').trim();
  const applicantCategory = normalizeApplicantCategory(productDetails.applicant_category);

  if (fundingType === 'تمويل شخصي') {
    return String(productDetails.employee_name || '').trim() || null;
  }

  if (['عقار', 'رهن'].includes(fundingType)) {
    if (applicantCategory === 'مالك منشأة') {
      return String(productDetails.owner_name || productDetails.applicant_name || '').trim() || null;
    }
    return String(productDetails.applicant_name || productDetails.employee_name || '').trim() || null;
  }

  return null;
}

function parseRequestRow(request = null) {
  if (!request) return request;
  return {
    ...request,
    product_details: parseObjectField(request.product_details),
  };
}

function isRajhiBank(bankName = '') {
  const normalized = normalizeText(bankName);
  return normalized.includes('راجحي') || normalized.includes('alrajhi') || normalized.includes('rajhi');
}

function isForeignOwnership(ownershipType = '') {
  return ['مستثمر', 'مختلط', 'أجنبي', 'اجنبي'].includes(String(ownershipType).trim());
}

function classifyEntityType(entityType = '') {
  const value = String(entityType).trim();
  if (['مؤسسة', 'شخص واحد', 'شركة شخص واحد'].includes(value)) return 'sole';
  if (['شركة متعددة الشركاء', 'شركة', 'أكثر من شريك'].includes(value)) return 'multi';
  return 'multi';
}

function pickEntity(entities, keywords, fallbackName, notes) {
  const match = entities.find(entity => keywords.some(keyword => normalizeText(entity.name).includes(normalizeText(keyword))));
  if (match) {
    return { ...match, notes: match.notes || notes };
  }
  return { id: fallbackName, name: fallbackName, notes };
}

function buildApproximateFundingRange(baseAmount, debtAmount) {
  const normalizedBaseAmount = Math.max(0, Math.round(Number(baseAmount) || 0));
  const normalizedDebtAmount = Math.max(0, Math.round(Number(debtAmount) || 0));
  const netAmount = Math.max(0, normalizedBaseAmount - normalizedDebtAmount);

  if (netAmount <= 0) {
    return {
      baseAmount: normalizedBaseAmount,
      debtDeductionAmount: normalizedDebtAmount,
      netAmount: 0,
      minAmount: 0,
      maxAmount: 0,
    };
  }

  return {
    baseAmount: normalizedBaseAmount,
    debtDeductionAmount: normalizedDebtAmount,
    netAmount,
    minAmount: Math.max(0, Math.round(netAmount * 0.9)),
    maxAmount: Math.max(0, Math.round(netAmount * 1.1)),
  };
}

// Helper: check eligibility against financing rules
async function checkEligibility(
  totalPos,
  totalDeposit,
  totalTransfer,
  months,
  fundingType,
  bankName = '',
  recordAgeMonths = 0,
  ownershipType = 'سعودي',
  entityType = 'شركة',
  liabilitiesAmount = 0,
  profitRatio = 0,
  personalSalary = 0,
  hasSimahIssues = false,
  hasServiceStop = false,
  personalNationality = 'سعودي',
  applicantCategory = '',
  propertyValue = 0,
  monthlyIncome = 0,
  hasDownPayment = false,
  downPaymentAmount = 0,
  hasPropertyTitle = false,
) {
  const entities = await db.prepare('SELECT * FROM funding_entities WHERE is_active = 1 ORDER BY priority DESC').all();
  const isRajhi = isRajhiBank(bankName);
  const isForeign = isForeignOwnership(ownershipType);
  const entityClass = classifyEntityType(entityType);
  const annualRevenue = Math.max(Number(totalPos) || 0, Number(totalDeposit) || 0, Number(totalTransfer) || 0, (Number(totalDeposit) || 0) + (Number(totalTransfer) || 0));
  const combinedMovement = (Number(totalDeposit) || 0) + (Number(totalTransfer) || 0);
  const debtAmount = Number(liabilitiesAmount) || 0;
  const debtRatio = annualRevenue > 0 ? Math.round((debtAmount / annualRevenue) * 100) : 0;
  const debtHealthy = annualRevenue > 0 && debtAmount <= annualRevenue * 0.3 && debtAmount < annualRevenue;
  const successProbability = debtHealthy ? 85 : 65;
  const estimatedFundingAmount = Math.round((Number(totalPos) > 0 ? Number(totalPos) : annualRevenue) * 0.6);
  const approximateFunding = buildApproximateFundingRange(annualRevenue * 0.3, debtAmount);
  const minAgeMonths = isForeign ? 36 : 24;
  const foreignRevenueFastTrackEligible = isForeign && annualRevenue >= 3000000 && recordAgeMonths >= 18;
  const tips = [];
  const matchedRules = [];
  let eligibleEntities = [];
  let isEligible = false;
  const salaryAmount = Number(personalSalary) || 0;
  const personalDebtRatio = salaryAmount > 0 ? Math.round((debtAmount / salaryAmount) * 100) : 0;
  const normalizedApplicantCategory = normalizeApplicantCategory(applicantCategory);
  const propertyAmount = Number(propertyValue) || 0;
  const monthlyIncomeAmount = Math.max(Number(monthlyIncome) || 0, salaryAmount || 0);
  const downPaymentValue = Number(downPaymentAmount) || 0;

  if (fundingType === 'تمويل شخصي') {
    const isSaudiCitizen = String(personalNationality || '').trim() === 'سعودي';
    const hasCleanSimah = !hasSimahIssues;
    const hasNoServiceBlocks = !hasServiceStop;
    const salaryEligible = salaryAmount >= 4000;
    const debtEligible = salaryAmount > 0 && debtAmount <= salaryAmount * 0.33;

    isEligible = isSaudiCitizen && salaryEligible && debtEligible && hasCleanSimah && hasNoServiceBlocks;

    if (isEligible) {
      matchedRules.push('تمويل شخصي سعودي بدون تعثر أو إيقاف خدمات');
      eligibleEntities = [
        pickEntity(
          entities,
          ['تمويل شخصي', 'شخصي'],
          'تمويل شخصي',
          'مؤهل لتمويل شخصي: الجنسية سعودي، الراتب 4,000 ر.س فأعلى، والمديونية لا تتجاوز 33% من الراتب مع خلو الحالة من التعثر وإيقاف الخدمات.'
        ),
      ];
    } else {
      if (!isSaudiCitizen) tips.push('التمويل الشخصي في هذا المسار مخصص حالياً للسعوديين فقط.');
      if (!salaryEligible) tips.push('يشترط أن يكون الراتب 4,000 ر.س فأعلى للتمويل الشخصي.');
      if (!debtEligible) tips.push('يشترط ألا تتجاوز المديونية القائمة 33% من الراتب الشهري.');
      if (!hasCleanSimah) tips.push('وجود تعثر أو تأخير في سمة يجعل الحالة غير مؤهلة للتمويل الشخصي.');
      if (!hasNoServiceBlocks) tips.push('وجود إيقاف خدمات أو سند تنفيذي يجعل الحالة غير مؤهلة للتمويل الشخصي.');
    }

    return {
      eligible: isEligible,
      entities: isEligible ? eligibleEntities : [],
      types: isEligible ? [fundingType] : [],
      tips,
      matchedRules,
      annualRevenue: salaryAmount,
      combinedMovement: 0,
      interestRateMin: 0,
      interestRateMax: 0,
      interestRateLabel: 'حسب جهة التمويل',
      estimatedFundingAmount: 0,
      debtAmount,
      debtRatio: personalDebtRatio,
      debtHealthy: debtEligible,
      successProbability: isEligible ? 85 : 0,
      profitRatio: 0,
      approximateFundingBaseAmount: null,
      approximateFundingMin: null,
      approximateFundingMax: null,
      exactAmountDisclaimer: 'المبلغ النهائي يعتمد على دراسة الطلب المكتمل واعتماد الجهة التمويلية.',
      needsCollateral: false,
      guaranteeNote: isEligible
        ? 'الحالة مستوفية لشروط التمويل الشخصي الأساسية.'
        : 'الحالة لا تستوفي شروط التمويل الشخصي الأساسية حالياً.',
    };
  }

  if (fundingType === 'عقار' || fundingType === 'رهن') {
    const isMortgageFunding = fundingType === 'رهن';
    const propertyMinimum = isMortgageFunding ? 250000 : 200000;
    const employeeIncomeMinimum = isMortgageFunding ? 5000 : 5000;
    const individualIncomeMinimum = isMortgageFunding ? 4000 : 5000;
    const businessRevenueMinimum = 500000;
    const titleReady = isMortgageFunding ? hasPropertyTitle : true;
    const hasSufficientDownPayment = isMortgageFunding ? true : (hasDownPayment && downPaymentValue >= propertyAmount * 0.1);
    const estimatedRealEstateFunding = Math.max(0, Math.round(propertyAmount - downPaymentValue));

    if (!propertyAmount || propertyAmount < propertyMinimum) {
      tips.push(`قيمة ${isMortgageFunding ? 'العقار أو أصل الرهن' : 'العقار'} يجب أن تبدأ من ${propertyMinimum.toLocaleString('ar-SA')} ر.س على الأقل لهذا المسار.`);
    }

    if (normalizedApplicantCategory === 'مالك منشأة') {
      const revenueEligible = annualRevenue >= businessRevenueMinimum;
      isEligible = propertyAmount >= propertyMinimum && revenueEligible && titleReady && hasSufficientDownPayment;

      if (isEligible) {
        matchedRules.push(isMortgageFunding ? 'رهن لمالك منشأة بعقار جاهز' : 'عقار لمالك منشأة بدخل نشاط كافٍ');
        eligibleEntities = [
          pickEntity(
            entities,
            [isMortgageFunding ? 'رهن' : 'عقار', 'عقاري', 'تمويل عقاري'],
            isMortgageFunding ? 'تمويل رهن عقاري' : 'تمويل عقاري',
            isMortgageFunding
              ? 'الحالة مناسبة مبدئياً لمسار الرهن لمالك منشأة مع عقار جاهز ومستندات دخل النشاط.'
              : 'الحالة مناسبة مبدئياً لمسار العقار لمالك منشأة عند توفر دخل النشاط والدفعة الأولى.'
          ),
        ];
      } else {
        if (!revenueEligible) tips.push(`لمسار مالك المنشأة نحتاج دخلاً للنشاط يبدأ من ${businessRevenueMinimum.toLocaleString('ar-SA')} ر.س تقريباً سنوياً أو ما يثبت القدرة المالية.`);
        if (isMortgageFunding && !titleReady) tips.push('في مسار الرهن يجب أن تكون بيانات العقار أو الصك جاهزة للمراجعة الأولية.');
        if (!isMortgageFunding && !hasSufficientDownPayment) tips.push('في التمويل العقاري لمالك المنشأة يفضّل توفر دفعة أولى لا تقل عن 10% من قيمة العقار.');
      }
    } else if (normalizedApplicantCategory === 'فرد') {
      const incomeEligible = monthlyIncomeAmount >= individualIncomeMinimum;
      isEligible = propertyAmount >= propertyMinimum && incomeEligible && titleReady && hasSufficientDownPayment;

      if (isEligible) {
        matchedRules.push(isMortgageFunding ? 'رهن لفرد بدخل شهري كافٍ' : 'عقار لفرد بدخل شهري كافٍ');
        eligibleEntities = [
          pickEntity(
            entities,
            [isMortgageFunding ? 'رهن' : 'عقار', 'عقاري', 'تمويل عقاري'],
            isMortgageFunding ? 'تمويل رهن عقاري' : 'تمويل عقاري',
            isMortgageFunding
              ? 'الحالة مناسبة مبدئياً للرهن لفرد مع عقار جاهز ورقم دخل مقبول.'
              : 'الحالة مناسبة مبدئياً لشراء عقار لفرد مع دخل مقبول ودفعة أولى.'
          ),
        ];
      } else {
        if (!incomeEligible) tips.push(`للفرد نحتاج دخلاً شهرياً يبدأ من ${individualIncomeMinimum.toLocaleString('ar-SA')} ر.س تقريباً لهذا المسار.`);
        if (isMortgageFunding && !titleReady) tips.push('في الرهن للفرد يجب توفر صك العقار أو بياناته الأساسية قبل التقديم.');
        if (!isMortgageFunding && !hasSufficientDownPayment) tips.push('في التمويل العقاري للفرد يفضّل وجود دفعة أولى بحد أدنى 10% من قيمة العقار.');
      }
    } else {
      const salaryEligible = salaryAmount >= employeeIncomeMinimum;
      isEligible = propertyAmount >= propertyMinimum && salaryEligible && titleReady && hasSufficientDownPayment;

      if (isEligible) {
        matchedRules.push(isMortgageFunding ? 'رهن لموظف براتب كافٍ' : 'عقار لموظف براتب ودفعة أولى');
        eligibleEntities = [
          pickEntity(
            entities,
            [isMortgageFunding ? 'رهن' : 'عقار', 'عقاري', 'تمويل عقاري'],
            isMortgageFunding ? 'تمويل رهن عقاري' : 'تمويل عقاري',
            isMortgageFunding
              ? 'الحالة مناسبة مبدئياً للرهن لموظف مع عقار جاهز وراتب كافٍ.'
              : 'الحالة مناسبة مبدئياً لشراء عقار لموظف براتب كافٍ ودفعة أولى.'
          ),
        ];
      } else {
        if (!salaryEligible) tips.push(`للموظف نحتاج راتباً شهرياً يبدأ من ${employeeIncomeMinimum.toLocaleString('ar-SA')} ر.س تقريباً لهذا المسار.`);
        if (isMortgageFunding && !titleReady) tips.push('في الرهن للموظف يجب توفر صك العقار أو بياناته الأساسية.');
        if (!isMortgageFunding && !hasSufficientDownPayment) tips.push('في التمويل العقاري للموظف يفضّل وجود دفعة أولى لا تقل عن 10% من قيمة العقار.');
      }
    }

    return {
      eligible: isEligible,
      entities: isEligible ? eligibleEntities : [],
      types: isEligible ? [fundingType] : [],
      tips,
      matchedRules,
      annualRevenue: normalizedApplicantCategory === 'مالك منشأة' ? annualRevenue : monthlyIncomeAmount,
      combinedMovement: 0,
      interestRateMin: 4.5,
      interestRateMax: 9.5,
      interestRateLabel: '4.5% - 9.5%',
      estimatedFundingAmount: estimatedRealEstateFunding,
      debtAmount,
      debtRatio: normalizedApplicantCategory === 'مالك منشأة' ? debtRatio : personalDebtRatio,
      debtHealthy: normalizedApplicantCategory === 'مالك منشأة' ? debtHealthy : (monthlyIncomeAmount > 0 ? debtAmount <= monthlyIncomeAmount * 0.45 : true),
      successProbability: isEligible ? (titleReady ? 82 : 70) : 0,
      profitRatio: Number(profitRatio) || 0,
      approximateFundingBaseAmount: null,
      approximateFundingMin: null,
      approximateFundingMax: null,
      exactAmountDisclaimer: 'المبلغ النهائي يعتمد على دراسة الطلب المكتمل واعتماد الجهة التمويلية.',
      needsCollateral: false,
      guaranteeNote: isMortgageFunding
        ? 'المراجعة النهائية للرهن تعتمد على سلامة بيانات العقار ونسبة التمويل إلى قيمة الأصل.'
        : 'المراجعة النهائية للتمويل العقاري تعتمد على قيمة العقار والدفعة الأولى والقدرة المالية.',
    };
  }

  const rajhiSolePosEligible = !isForeign && entityClass === 'sole' && isRajhi && recordAgeMonths >= 7 && Number(totalPos) >= 700000;
  const rajhiSoleRevenueEligible = !isForeign && entityClass === 'sole' && isRajhi && recordAgeMonths >= 24 && annualRevenue >= 3000000;
  const rajhiMultiPosEligible = !isForeign && entityClass === 'multi' && isRajhi && recordAgeMonths >= 24 && Number(totalPos) >= 1000000;
  const foreignRajhiPosEligible = isForeign && isRajhi && recordAgeMonths >= 36 && Number(totalPos) >= 1000000;
  const otherBankPosEligible = !isRajhi && recordAgeMonths >= minAgeMonths && Number(totalPos) >= 2000000;
  const movementEligible = combinedMovement >= 3000000 && recordAgeMonths >= minAgeMonths;

  if (fundingType === 'نقاط بيع') {
    if (foreignRevenueFastTrackEligible) {
      isEligible = true;
      matchedRules.push('منشأة أجنبية أو مستثمر بإيرادات 3 مليون فأكثر');
      eligibleEntities = [
        pickEntity(
          entities,
          [isRajhi ? 'راجحي' : 'الأولى', 'راجحي', 'الأولى'],
          isRajhi ? 'مصرف الراجحي' : 'تمويل نقاط بيع أو كاش',
          'الحالة الاستثنائية للمنشأة الأجنبية أو المستثمر: إيرادات 3,000,000 ر.س فأكثر مع عمر سجل 18 شهراً فأكثر يمكن أن تمشي في الكاش أو نقاط البيع.'
        ),
      ];
    } else if (rajhiSolePosEligible || rajhiSoleRevenueEligible) {
      isEligible = true;
      matchedRules.push('مؤسسة أو شركة شخص واحد سعودية على الراجحي');
      eligibleEntities = [
        pickEntity(entities, ['راجحي'], 'مصرف الراجحي', 'حساب راجحي مع عمر يبدأ من 7 أشهر عند نقاط البيع المؤهلة، أو عمر سنتين فأكثر مع إيرادات 3 مليون فأعلى.'),
        pickEntity(entities, ['أمكان', 'امكان'], 'أمكان', 'يناسب حالات المؤسسة أو شركة الشخص الواحد السعودية عند تحقق شروط الراجحي الأساسية.'),
      ];
    } else if (rajhiMultiPosEligible) {
      isEligible = true;
      matchedRules.push('شركة متعددة الشركاء سعودية على الراجحي');
      eligibleEntities = [
        pickEntity(entities, ['راجحي'], 'مصرف الراجحي', 'شركة سعودية متعددة الشركاء بحساب راجحي ونقاط بيع لا تقل عن 1,000,000 ر.س وعمر سجل 24 شهراً فأكثر.'),
      ];
    } else if (foreignRajhiPosEligible) {
      isEligible = true;
      matchedRules.push('شركة مستثمر/أجنبية على الراجحي');
      eligibleEntities = [
        pickEntity(entities, ['راجحي'], 'مصرف الراجحي', 'للمنشآت الاستثمارية أو الأجنبية بعمر سجل 36 شهراً فأكثر، مع تطبيق اشتراطات إضافية على القوائم المالية.'),
      ];
    } else if (otherBankPosEligible) {
      isEligible = true;
      matchedRules.push('نقاط بيع من بنك خارج الراجحي');
      eligibleEntities = [
        pickEntity(entities, ['الأولى', 'الاولى'], 'الأولى للتمويل', 'للحسابات خارج الراجحي: عمر 24 شهراً للسعودي و36 شهراً للمستثمر/الأجنبي، وإجمالي نقاط بيع لا يقل عن 2,000,000 ر.س.'),
      ];
    }

    if (!isEligible) {
      if (isRajhi && entityClass === 'sole' && Number(totalPos) < 700000 && annualRevenue < 3000000) {
        tips.push('للمؤسسة أو شركة الشخص الواحد على الراجحي: ارفع نقاط البيع إلى 700,000 ر.س على الأقل أو ارفع الإيرادات إلى 3,000,000 ر.س مع عمر سنتين فأكثر.');
      }
      if (isRajhi && entityClass === 'multi' && Number(totalPos) < 1000000) {
        tips.push('للشركة متعددة الشركاء على الراجحي: إجمالي نقاط البيع المطلوب لا يقل عن 1,000,000 ر.س لآخر 12 شهر.');
      }
      if (!isRajhi && Number(totalPos) < 2000000) {
        tips.push('للحسابات خارج الراجحي: إجمالي نقاط البيع المطلوب لا يقل عن 2,000,000 ر.س لآخر 12 شهر.');
      }
      if (recordAgeMonths < minAgeMonths && !(isRajhi && entityClass === 'sole' && !isForeign)) {
        tips.push(`عمر السجل الحالي ${recordAgeMonths} شهر، بينما المطلوب ${minAgeMonths} شهر لهذه الحالة.`);
      }
      if (isForeign && annualRevenue < 3000000 && recordAgeMonths < 36) {
        tips.push('للمستثمر أو المنشأة الأجنبية في نقاط البيع: العمر المعتاد 36 شهراً، ويستثنى من ذلك من لديه إيرادات 3,000,000 ر.س فأكثر بعمر 18 شهراً فأعلى.');
      }
      if (isForeign && annualRevenue < 3000000) {
        tips.push('للاستفادة من الاستثناء الأجنبي في الكاش أو نقاط البيع: يجب أن تكون الإيرادات 3,000,000 ر.س فأكثر مع عمر سجل 18 شهراً على الأقل.');
      }
    }
  }

  if (!isEligible && (fundingType !== 'نقاط بيع' || combinedMovement > 0)) {
    if (fundingType === 'كاش' && foreignRevenueFastTrackEligible) {
      isEligible = true;
      matchedRules.push('منشأة أجنبية أو مستثمر كاش بإيرادات 3 مليون فأكثر');
      eligibleEntities = [
        pickEntity(
          entities,
          [isRajhi ? 'راجحي' : 'الأولى', 'راجحي', 'الأولى'],
          isRajhi ? 'مصرف الراجحي' : 'تمويل كاش',
          'الحالة الاستثنائية للمنشأة الأجنبية أو المستثمر في الكاش: إيرادات 3,000,000 ر.س فأكثر مع عمر سجل 18 شهراً فأكثر.'
        ),
      ];
    } else if (movementEligible) {
      isEligible = true;
      matchedRules.push(isRajhi ? 'حركة حساب إيداع وتحويل على الراجحي' : 'حركة حساب إيداع وتحويل خارج الراجحي');
      eligibleEntities = [
        pickEntity(
          entities,
          [isRajhi ? 'راجحي' : 'الأولى', 'راجحي', 'الأولى'],
          isRajhi ? 'مصرف الراجحي' : 'جهات تمويل حسب دراسة الملف',
          isRajhi
            ? 'تمويل قائم على حركة الإيداع والتحويل مع اشتراط عمر 24 شهراً للسعودي و36 شهراً للمستثمر أو الأجنبي.'
            : 'للحسابات خارج الراجحي يطبق حد العمر نفسه، وتخضع الملاءمة النهائية لدراسة الملف.'
        ),
      ];
    } else {
      if (fundingType === 'كاش' && isForeign && !foreignRevenueFastTrackEligible) {
        tips.push('في الكاش للمستثمر أو المنشأة الأجنبية: يمكن قبول الحالة إذا كانت الإيرادات 3,000,000 ر.س فأكثر وعمر السجل 18 شهراً على الأقل.');
      }
      if (combinedMovement < 3000000) {
        tips.push('في تمويل الإيداع والتحويل: نوصي برفع حركة الحساب إلى 3,000,000 ر.س فأكثر لتحسين الأهلية.');
      }
      if (recordAgeMonths < minAgeMonths) {
        tips.push(`في حركة الحساب: العمر المطلوب ${minAgeMonths} شهر لهذه الحالة.`);
      }
    }
  }

  if (months < 6) {
    tips.push('يفضل تقديم كشف حساب لـ 6 أشهر على الأقل، والأفضل 12 شهراً عند نقاط البيع وحركة الحساب.');
  }

  if (!debtHealthy && annualRevenue > 0) {
    tips.push('المديونيات الحالية تتجاوز 30% من الإيرادات أو ليست أقل من الإيرادات، لذا تنخفض نسبة النجاح التقديرية إلى 65%.');
  } else if (annualRevenue > 0) {
    tips.push('المديونيات ضمن النطاق الصحي: لا تتجاوز 30% من الإيرادات وأقل من الإيرادات السنوية.' );
  }

  const guaranteeNote = isForeign
    ? (Number(profitRatio) >= 8
        ? 'القوائم المالية بربحية 8% فأكثر، لذلك لا يتوقع طلب رهن أو كفيل من ناحية الربحية.'
        : 'للمنشآت الاستثمارية أو الأجنبية قد يطلب كفيل أو رهن إذا كانت ربحية القوائم أقل من 8% أو الربح بسيطاً.')
    : 'الربحية الجيدة في القوائم المالية ترفع فرصة الاعتماد وتحسن التسعير النهائي.';

  return {
    eligible: isEligible,
    entities: isEligible ? eligibleEntities : [],
    types: isEligible ? [fundingType] : [],
    tips,
    matchedRules,
    annualRevenue,
    combinedMovement,
    interestRateMin: 7,
    interestRateMax: 14,
    interestRateLabel: '7% - 14%',
    estimatedFundingAmount: isEligible ? approximateFunding.netAmount : estimatedFundingAmount,
    debtAmount,
    debtRatio,
    debtHealthy,
    successProbability,
    profitRatio: Number(profitRatio) || 0,
    approximateFundingBaseAmount: isEligible ? approximateFunding.baseAmount : null,
    approximateFundingMin: isEligible ? approximateFunding.minAmount : null,
    approximateFundingMax: isEligible ? approximateFunding.maxAmount : null,
    exactAmountDisclaimer: 'من أجل تحديد مبلغ التمويل الصحيح يجب تقديم الطلب مكتملًا للدراسة والاعتماد.',
    needsCollateral: isForeign && Number(profitRatio) < 8,
    guaranteeNote,
  };
}

// Helper: check and update docs status
async function checkAndUpdateDocStatus(requestId) {
  const docs = await db.prepare('SELECT * FROM request_documents WHERE request_id = ?').all(requestId);
  if (docs.length === 0) return;
  const allUploaded = docs.every(d => d.file_path !== null);
  const allValid = docs.every(d => d.status === 'valid');
  if (allUploaded && allValid) {
    await db.prepare("UPDATE requests SET status = 'docs_ready', updated_at = NOW() WHERE id = ?").run(requestId);
  }
}

async function getRequestForAccess(requestId) {
  return db.prepare('SELECT id, user_id FROM requests WHERE id = ?').get(requestId);
}

function canAccessRequestChat(request, user) {
  if (!request) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'employee' && Number(request.user_id) === Number(user.id)) return true;
  return false;
}

// POST /api/requests/eligibility-check — فحص أهلية المنشأة
router.post('/eligibility-check', authMiddleware, async (req, res) => {
  try {
    const {
      totalPos = 0, totalDeposit = 0, totalTransfer = 0,
      months = 12, fundingType = 'نقاط بيع', bankName = '',
      recordAgeMonths = 0, ownershipType = 'سعودي', entityType = 'شركة',
      liabilitiesAmount = 0, profitRatio = 0,
      personalSalary = 0, hasSimahIssues = false, hasServiceStop = false, personalNationality = 'سعودي',
      applicantCategory = '', propertyValue = 0, monthlyIncome = 0,
      hasDownPayment = false, downPaymentAmount = 0, hasPropertyTitle = false,
    } = req.body;

    const result = await checkEligibility(
      Number(totalPos), Number(totalDeposit), Number(totalTransfer),
      Number(months), fundingType, bankName,
      Number(recordAgeMonths), ownershipType, entityType,
      Number(liabilitiesAmount), Number(profitRatio),
      Number(personalSalary), Boolean(hasSimahIssues), Boolean(hasServiceStop), personalNationality,
      applicantCategory, Number(propertyValue), Number(monthlyIncome),
      Boolean(hasDownPayment), Number(downPaymentAmount), Boolean(hasPropertyTitle)
    );

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في فحص الأهلية' });
  }
});

// GET /api/requests/partners-list — list of approved partners (for broker dropdown)
router.get('/partners-list', authMiddleware, async (req, res) => {
  try {
    const partners = await db.prepare(`
      SELECT id, name, phone, role, partner_type FROM users
      WHERE role = 'partner' AND status = 'approved'
      ORDER BY name
    `).all();
    res.json(partners);
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// GET /api/requests
router.get('/', authMiddleware, async (req, res) => {
  try {
    const requests = await db.prepare(`
      SELECT r.*,
             fe.name as funding_entity_name,
             p.name as referred_by_name,
             p.phone as referred_by_phone,
             (SELECT COUNT(*) FROM request_documents rd WHERE rd.request_id = r.id) as doc_total,
             (SELECT COUNT(*) FROM request_documents rd WHERE rd.request_id = r.id AND rd.status = 'valid') as doc_valid,
             (SELECT COALESCE(json_agg(json_build_object('id', bs.id, 'file_name', bs.file_name)) FILTER (WHERE bs.id IS NOT NULL), '[]'::json) FROM bank_statements bs WHERE bs.request_id = r.id) as bank_statements,
             (SELECT COALESCE(json_agg(json_build_object('id', acs.id, 'file_name', acs.file_name)) FILTER (WHERE acs.id IS NOT NULL), '[]'::json) FROM account_statements acs WHERE acs.request_id = r.id) as account_statements,
             (SELECT COALESCE(json_agg(json_build_object('id', td.id, 'file_name', td.file_name)) FILTER (WHERE td.id IS NOT NULL), '[]'::json) FROM tax_documents td WHERE td.request_id = r.id) as tax_documents
      FROM requests r
      LEFT JOIN funding_entities fe ON r.funding_entity_id = fe.id
      LEFT JOIN users p ON r.referred_by_id = p.id
      WHERE r.user_id = ?
      ORDER BY r.updated_at DESC
    `).all(req.user.id);
    res.json((requests || []).map(parseRequestRow));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع الطلبات' });
  }
});

// POST /api/requests
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (!canCreateRequests(req.user)) return res.status(403).json({ error: 'ليس لديك صلاحية إنشاء الطلبات' });
    const { funding_type, entity_type, ownership_type, owners_count, owner_phone, referred_by_id } = req.body;
    const productDetails = parseObjectField(req.body?.product_details);
    const requestName = resolveRequestPrimaryName(req.body, productDetails);
    const ownerName = resolveOwnerName(req.body, productDetails);
    if (!requestName) {
      return res.status(400).json({ error: 'أكمل الاسم الأساسي للطلب قبل المتابعة' });
    }
    let partnerId = null;
    if (referred_by_id) {
      const partner = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'partner' AND status = 'approved'").get(referred_by_id);
      if (partner) partnerId = partner.id;
    }
    const result = await db.prepare(`
      INSERT INTO requests (user_id, funding_type, company_name, entity_type, ownership_type, owners_count, owner_name, owner_phone, referred_by_id, product_details, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      req.user.id,
      funding_type || 'نقاط بيع',
      requestName,
      entity_type || 'شركة',
      ownership_type || 'سعودي',
      owners_count || 'شخص واحد',
      ownerName,
      owner_phone || null,
      partnerId,
      JSON.stringify(productDetails || {})
    );

    const reqId = result.lastInsertRowid;

    await db.prepare(`
      INSERT INTO companies (company_name, entity_type, owner_name, owner_phone, request_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(requestName, entity_type || 'شركة', ownerName, owner_phone || null, reqId, req.user.id);

    await ensureRequestDocuments(reqId, {
      funding_type: funding_type || 'نقاط بيع',
      entity_type: entity_type || 'شركة',
      ownership_type: ownership_type || 'سعودي',
      product_details: productDetails,
    });

    const request = parseRequestRow(await db.prepare('SELECT * FROM requests WHERE id = ?').get(reqId));
    await createNotification(req.user.id, {
      type: 'success',
      title: `تم إنشاء طلب ${requestName}`,
      body: 'تم استلام طلبك بنجاح وهو الآن بانتظار المراجعة.',
      link: `/requests?view=${reqId}`,
    });
    await notifyAdmins({
      type: 'general',
      title: 'طلب جديد بانتظار المراجعة',
      body: `${req.user.name} أضاف طلب ${requestName}`,
      link: `/requests?view=${reqId}`,
    });
    res.status(201).json(request);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في إنشاء الطلب' });
  }
});

// GET /api/requests/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const request = await db.prepare(`
      SELECT r.*, fe.name as funding_entity_name, fe.whatsapp_number as fe_whatsapp,
             fe.required_documents as fe_required_docs,
             u.name as user_name, u.phone as user_phone, u.email as user_email,
             p.name as referred_by_name, p.phone as referred_by_phone, p.partner_type as referred_by_type
      FROM requests r
      LEFT JOIN funding_entities fe ON r.funding_entity_id = fe.id
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN users p ON r.referred_by_id = p.id
      WHERE r.id = ? AND (r.user_id = ? OR ? = 'admin')
    `).get(req.params.id, req.user.id, req.user.role);

    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

    await ensureRequestDocuments(req.params.id, request);

    const bankStatements = await db.prepare('SELECT * FROM bank_statements WHERE request_id = ? ORDER BY uploaded_at').all(req.params.id);
    const accountStatements = await db.prepare('SELECT * FROM account_statements WHERE request_id = ? ORDER BY uploaded_at').all(req.params.id);
    const taxDocuments = await db.prepare('SELECT * FROM tax_documents WHERE request_id = ? ORDER BY uploaded_at').all(req.params.id);
    const documents = await db.prepare('SELECT * FROM request_documents WHERE request_id = ? ORDER BY id').all(req.params.id);
    const statusHistory = await db.prepare(`
      SELECT sh.*, u.name as created_by_name
      FROM status_history sh
      LEFT JOIN users u ON sh.created_by = u.id
      WHERE sh.request_id = ? ORDER BY sh.created_at DESC
    `).all(req.params.id);

    let analysisResult = {};
    try { analysisResult = JSON.parse(request.analysis_result || '{}'); } catch (e) {}

    res.json({ ...parseRequestRow(request), analysis_result: analysisResult, bank_statements: bankStatements, account_statements: accountStatements, tax_documents: taxDocuments, documents, status_history: statusHistory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع الطلب' });
  }
});

// GET /api/requests/:id/messages — internal chat (admin + employee owner)
router.get('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const request = await getRequestForAccess(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!canAccessRequestChat(request, req.user)) return res.status(403).json({ error: 'غير مصرح' });

    const messages = await db.prepare(`
      SELECT rm.id, rm.request_id, rm.sender_id, rm.message, rm.attachment_path, rm.attachment_name, rm.created_at,
             u.name as sender_name, u.role as sender_role
      FROM request_messages rm
      LEFT JOIN users u ON u.id = rm.sender_id
      WHERE rm.request_id = ?
      ORDER BY rm.created_at ASC, rm.id ASC
    `).all(req.params.id);

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تحميل المحادثة' });
  }
});

// POST /api/requests/:id/messages — send internal chat message
router.post('/:id/messages', authMiddleware, chatAttachmentUpload.single('file'), async (req, res) => {
  try {
    const request = await getRequestForAccess(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!canAccessRequestChat(request, req.user)) return res.status(403).json({ error: 'غير مصرح' });

    const message = String(req.body?.message || '').trim();
    const attachmentPath = req.file ? req.file.path : null;
    const attachmentName = req.file ? decodeUploadedFileName(req.file.originalname) : null;
    if (!message && !attachmentPath) return res.status(400).json({ error: 'اكتب رسالة أو أرفق ملفاً' });

    const r = await db.prepare('INSERT INTO request_messages (request_id, sender_id, message, attachment_path, attachment_name) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, req.user.id, message || '', attachmentPath, attachmentName);

    const created = await db.prepare(`
      SELECT rm.id, rm.request_id, rm.sender_id, rm.message, rm.attachment_path, rm.attachment_name, rm.created_at,
             u.name as sender_name, u.role as sender_role
      FROM request_messages rm
      LEFT JOIN users u ON u.id = rm.sender_id
      WHERE rm.id = ?
    `).get(r.lastInsertRowid);

    if (req.user.role === 'admin') {
      await createNotification(request.user_id, {
        type: 'message',
        title: `رسالة جديدة على طلب ${request.company_name}`,
        body: message || `تم إرفاق ملف: ${attachmentName}`,
        link: `/requests?view=${request.id}`,
      });
    } else {
      await notifyAdmins({
        type: 'message',
        title: `رسالة جديدة من ${req.user.name}`,
        body: `${request.company_name}: ${message || `تم إرفاق ملف: ${attachmentName}`}`,
        link: `/requests?view=${request.id}`,
      }, { excludeUserId: req.user.id });
    }

    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في إرسال الرسالة' });
  }
});

// GET /api/messages/unread-count — عدد الرسائل غير المقروءة في جميع الطلبات
router.get('/messages/unread-count', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const role   = req.user.role;
    const row = role === 'admin'
      ? await db.prepare(`
          SELECT COUNT(*) as c FROM request_messages rm
          LEFT JOIN message_reads mr ON mr.user_id = ? AND mr.request_id = rm.request_id
          WHERE rm.sender_id != ?
            AND (mr.last_read_at IS NULL OR rm.created_at > mr.last_read_at)
        `).get(userId, userId)
      : await db.prepare(`
          SELECT COUNT(*) as c FROM request_messages rm
          JOIN requests r ON r.id = rm.request_id
          LEFT JOIN message_reads mr ON mr.user_id = ? AND mr.request_id = rm.request_id
          WHERE r.user_id = ? AND rm.sender_id != ?
            AND (mr.last_read_at IS NULL OR rm.created_at > mr.last_read_at)
        `).get(userId, userId, userId);
    res.json({ count: row?.c || 0 });
  } catch (err) {
    res.status(500).json({ count: 0 });
  }
});

// POST /api/requests/:id/mark-read — تحديد رسائل الطلب كمقروءة
router.post('/:id/mark-read', authMiddleware, async (req, res) => {
  try {
    await db.prepare(`
      INSERT INTO message_reads (user_id, request_id, last_read_at)
      VALUES (?, ?, NOW())
      ON CONFLICT(user_id, request_id) DO UPDATE SET last_read_at = NOW()
    `).run(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// POST /api/requests/:id/bank-statements
router.post('/:id/bank-statements', authMiddleware, bankUpload.array('files', 15), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });

    const inserted = [];
    for (const file of req.files) {
      const fixedName = decodeUploadedFileName(file.originalname);
      const r = await db.prepare(`
        INSERT INTO bank_statements (request_id, file_path, file_name, analysis_status)
        VALUES (?, ?, ?, 'pending')
      `).run(req.params.id, file.path, fixedName);
      inserted.push({ id: r.lastInsertRowid, file_name: fixedName });
    }

    await db.prepare("UPDATE requests SET status = 'bank_uploaded', updated_at = NOW() WHERE id = ?").run(req.params.id);
    res.json({ message: `تم رفع ${req.files.length} كشف بنجاح`, statements: inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في رفع الملفات' });
  }
});

// POST /api/requests/:id/analyze-banks
router.post('/:id/analyze-banks', authMiddleware, async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

    const statements = await db.prepare("SELECT * FROM bank_statements WHERE request_id = ? AND analysis_status = 'pending'").all(req.params.id);
    if (statements.length === 0) return res.status(400).json({ error: 'لا توجد كشوفات جديدة للتحليل' });

    await db.prepare("UPDATE requests SET status = 'analyzing', updated_at = NOW() WHERE id = ?").run(req.params.id);

    let totalPos = 0, totalDeposit = 0, totalTransfer = 0;
    const details = [];
    const errors = [];

    for (const stmt of statements) {
      try {
        const analysis = await analyzeBankStatement(stmt.file_path, stmt.file_name);
        await db.prepare(`
          UPDATE bank_statements SET
            pos_amount = ?, deposit_amount = ?, transfer_amount = ?,
            period_label = ?, analysis_status = 'done', analysis_data = ?
          WHERE id = ?
        `).run(analysis.total_pos, analysis.total_deposit, analysis.total_transfer,
               analysis.period_label, JSON.stringify(analysis), stmt.id);
        totalPos += analysis.total_pos;
        totalDeposit += analysis.total_deposit;
        totalTransfer += analysis.total_transfer;
        details.push({ stmt_id: stmt.id, ...analysis });
      } catch (aiErr) {
        await db.prepare("UPDATE bank_statements SET analysis_status = 'failed' WHERE id = ?").run(stmt.id);
        errors.push({ stmt_id: stmt.id, file: stmt.file_name, error: aiErr.message });
      }
    }

    // Add previously analyzed statements
    const prevAnalyzed = await db.prepare("SELECT * FROM bank_statements WHERE request_id = ? AND analysis_status = 'done'").all(req.params.id);
    for (const ps of prevAnalyzed) {
      if (!details.find(d => d.stmt_id === ps.id)) {
        totalPos += ps.pos_amount;
        totalDeposit += ps.deposit_amount;
        totalTransfer += ps.transfer_amount;
      }
    }

    const monthCount = (await db.prepare("SELECT COUNT(*) as c FROM bank_statements WHERE request_id = ? AND analysis_status = 'done'").get(req.params.id)).c;
    const firstStmt = await db.prepare("SELECT * FROM bank_statements WHERE request_id = ? LIMIT 1").get(req.params.id);
    const bankName = firstStmt ? (JSON.parse(firstStmt.analysis_data || '{}').bank_name || '') : '';
    const recordAgeMonths = monthCount;
    const eligibility = await checkEligibility(totalPos, totalDeposit, totalTransfer, monthCount, request.funding_type, bankName, recordAgeMonths, request.ownership_type, request.entity_type);
    const eligibleEntities = eligibility.entities;
    const eligibleTypes = eligibility.types;

    await db.prepare(`
      UPDATE requests SET
        total_pos = ?, total_deposit = ?, total_transfer = ?,
        statement_months = ?, status = 'analyzed',
        analysis_result = ?, updated_at = NOW()
      WHERE id = ?
    `).run(totalPos, totalDeposit, totalTransfer, monthCount,
           JSON.stringify({ details, eligible_entities: eligibleEntities, eligible_types: eligibleTypes, errors }),
           req.params.id);

    res.json({ total_pos: totalPos, total_deposit: totalDeposit, total_transfer: totalTransfer, months: monthCount, eligible_entities: eligibleEntities, eligible_types: eligibleTypes, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'خطأ في التحليل' });
  }
});

// POST /api/requests/:id/account-statements
router.post('/:id/account-statements', authMiddleware, accountUpload.array('files', 15), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });

    const inserted = [];
    for (const file of req.files) {
      const fixedName = decodeUploadedFileName(file.originalname);
      const r = await db.prepare(`
        INSERT INTO account_statements (request_id, file_path, file_name)
        VALUES (?, ?, ?)
      `).run(req.params.id, file.path, fixedName);
      inserted.push({ id: r.lastInsertRowid, file_name: fixedName });
    }

    res.json({ message: `تم رفع ${req.files.length} كشف حساب بنجاح`, statements: inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في رفع الملفات' });
  }
});

// POST /api/requests/:id/tax-documents
router.post('/:id/tax-documents', authMiddleware, taxUpload.array('files', 15), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });

    const inserted = [];
    for (const file of req.files) {
      const fixedName = decodeUploadedFileName(file.originalname);
      const r = await db.prepare(`
        INSERT INTO tax_documents (request_id, file_path, file_name)
        VALUES (?, ?, ?)
      `).run(req.params.id, file.path, fixedName);
      inserted.push({ id: r.lastInsertRowid, file_name: fixedName });
    }

    res.json({ message: `تم رفع ${req.files.length} وثيقة ضريبية بنجاح`, documents: inserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في رفع الملفات' });
  }
});

// POST /api/requests/:id/select-entity
router.post('/:id/select-entity', authMiddleware, async (req, res) => {
  try {
    const { funding_entity_id } = req.body;
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

    const entity = await db.prepare('SELECT * FROM funding_entities WHERE id = ?').get(funding_entity_id);
    if (!entity) return res.status(404).json({ error: 'الجهة التمويلية غير موجودة' });

    const requiredDocs = JSON.parse(entity.required_documents || '[]');

    await ensureRequestDocuments(req.params.id, request, requiredDocs);

    await db.prepare("UPDATE requests SET funding_entity_id = ?, status = 'docs_pending', updated_at = NOW() WHERE id = ?").run(funding_entity_id, req.params.id);

    res.json({ message: 'تم اختيار الجهة التمويلية', required_documents: requiredDocs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في اختيار الجهة' });
  }
});

// POST /api/requests/:id/documents/:docId/upload
router.post('/:id/documents/:docId/upload', authMiddleware, docUpload.single('file'), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

    const doc = await db.prepare('SELECT * FROM request_documents WHERE id = ? AND request_id = ?').get(req.params.docId, req.params.id);
    if (!doc) return res.status(404).json({ error: 'المستند غير موجود' });
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع الملف' });

    let expiryDate = null;
    let docStatus = 'valid';
    let aiResult = null;

    try {
      aiResult = await analyzeDocument(req.file.path, decodeUploadedFileName(req.file.originalname));
      expiryDate = aiResult.expiry_date && aiResult.expiry_date !== 'null' ? aiResult.expiry_date : null;
      docStatus = aiResult.is_expired ? 'expired' : 'valid';
    } catch (aiErr) {
      console.error('Doc AI error:', aiErr.message);
      docStatus = 'valid';
    }

    const fixedName = decodeUploadedFileName(req.file.originalname);

    await db.prepare(`
      UPDATE request_documents SET
        file_path = ?, file_name = ?, expiry_date = ?, status = ?, uploaded_at = NOW()
      WHERE id = ?
    `).run(req.file.path, fixedName, expiryDate, docStatus, req.params.docId);

    await checkAndUpdateDocStatus(req.params.id);

    res.json({
      message: docStatus === 'expired' ? '⚠️ تحذير: المستند منتهي الصلاحية! يرجى تحديثه.' : 'تم رفع المستند بنجاح',
      status: docStatus,
      expiry_date: expiryDate,
      ai_notes: aiResult?.notes || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في رفع المستند' });
  }
});

// POST /api/requests/:id/mark-forms-sent
router.post('/:id/mark-forms-sent', authMiddleware, async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    await db.prepare("UPDATE requests SET status = 'forms_sent', updated_at = NOW() WHERE id = ?").run(req.params.id);
    res.json({ message: 'تم تأكيد رفع النماذج للجهة التمويلية' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// POST /api/requests/:id/submit-file
router.post('/:id/submit-file', authMiddleware, completeUpload.single('file'), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

    const packageInfo = await ensureCompletePackage(request);
    const uploadedFilePath = req.file ? req.file.path : null;
    const uploadedFileName = req.file ? decodeUploadedFileName(req.file.originalname) : null;
    const finalFilePath = packageInfo?.filePath || uploadedFilePath || request.complete_file_path || null;
    const finalFileName = packageInfo?.fileName || uploadedFileName || request.complete_file_name || null;
    const submissionNote = packageInfo?.created
      ? `تم إنشاء ملف مضغوط يحتوي على ${packageInfo.entryCount || 0} مرفق`
      : (req.file ? 'تم رفع الملف الكامل من الموظف' : 'تم إرسال المستندات المرفوعة من الموظف');
    const notificationTitle = packageInfo?.created
      ? `تم تجهيز ملف مضغوط لطلب ${request.company_name}`
      : (req.file ? `تم رفع الملف الكامل لطلب ${request.company_name}` : `تم إرسال مستندات طلب ${request.company_name}`);
    const notificationBody = packageInfo?.created
      ? `${req.user.name} جهز ملفاً مضغوطاً بانتظار مراجعة الإدارة.`
      : (req.file ? `${req.user.name} رفع الملف الكامل بانتظار مراجعة الإدارة.` : `${req.user.name} أرسل المستندات والكشوفات المرفوعة بانتظار مراجعة الإدارة.`);

    await db.prepare(`
      UPDATE requests SET
        status = 'file_submitted',
        complete_file_path = ?,
        complete_file_name = ?,
        updated_at = NOW()
      WHERE id = ?
    `).run(finalFilePath, finalFileName, req.params.id);

    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?, ?, ?, ?)').run(
      req.params.id, 'file_submitted', submissionNote, req.user.id
    );

    await notifyAdmins({
      type: 'update',
      title: notificationTitle,
      body: notificationBody,
      link: `/requests?view=${request.id}`,
    }, { excludeUserId: req.user.id });

    res.json({
      message: packageInfo?.created
        ? 'تم تجميع المستندات في ملف مضغوط وإرساله بنجاح.'
        : (req.file ? 'تم إرسال الملف للمدير بنجاح. سيتم مراجعته قريباً.' : 'تم إرسال الطلب بمرفقاته الحالية للمدير بنجاح.'),
      package_url: toPublicUploadUrl(finalFilePath),
      package_name: finalFileName,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في إرسال الملف' });
  }
});

// POST /api/requests/:id/submit-missing
router.post('/:id/submit-missing', authMiddleware, async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

    await db.prepare("UPDATE requests SET status = 'missing_submitted', updated_at = NOW() WHERE id = ?").run(req.params.id);
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?, ?, ?, ?)').run(
      req.params.id, 'missing_submitted', 'تم إرسال النواقص من الموظف', req.user.id
    );

    await notifyAdmins({
      type: 'update',
      title: `تم استكمال نواقص طلب ${request.company_name}`,
      body: `${req.user.name} أعاد إرسال النواقص للمراجعة.`,
      link: `/requests?view=${request.id}`,
    }, { excludeUserId: req.user.id });

    res.json({ message: 'تم إرسال النواقص للمدير بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ' });
  }
});

// POST /api/requests/:id/upload-consultation-contract — employee uploads consultation contract
router.post('/:id/upload-consultation-contract', authMiddleware, contractUpload.single('file'), async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!req.file) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });

    await db.prepare(
      'INSERT INTO contracts (request_id, contract_type, file_path, file_name, uploaded_by) VALUES (?, ?, ?, ?, ?)'
    ).run(req.params.id, 'consultation', req.file.path, decodeUploadedFileName(req.file.originalname), req.user.id);

    await db.prepare(`
      UPDATE requests SET
        consultation_contract_path = ?,
        consultation_contract_name = ?,
        status = 'contract_submitted',
        updated_at = NOW()
      WHERE id = ?
    `).run(req.file.path, decodeUploadedFileName(req.file.originalname), req.params.id);

    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?, ?, ?, ?)').run(
      req.params.id, 'contract_submitted', 'تم رفع عقد الاستشارات وإرساله للمدير', req.user.id
    );

    res.json({ message: 'تم رفع عقد الاستشارات بنجاح وإرساله للمدير' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في رفع العقد' });
  }
});

// PUT /api/requests/:id — edit basic request info
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (req.user.role !== 'admin' && request.user_id !== req.user.id) {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const { owner_phone, entity_type, ownership_type, funding_type, referred_by_id } = req.body;
    const nextFundingType = funding_type || request.funding_type;
    const productDetails = req.body?.product_details !== undefined
      ? parseObjectField(req.body.product_details)
      : parseObjectField(request.product_details);
    const requestName = resolveRequestPrimaryName({ ...request, ...req.body, funding_type: nextFundingType }, productDetails);
    const ownerName = resolveOwnerName({ ...request, ...req.body, funding_type: nextFundingType }, productDetails);
    if (!requestName) return res.status(400).json({ error: 'أكمل الاسم الأساسي للطلب قبل الحفظ' });
    let partnerId = request.referred_by_id;
    if (referred_by_id !== undefined) {
      if (referred_by_id) {
        const partner = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'partner' AND status = 'approved'").get(referred_by_id);
        partnerId = partner ? partner.id : null;
      } else { partnerId = null; }
    }
    await db.prepare(`
      UPDATE requests SET
        company_name = ?, owner_name = ?, owner_phone = ?,
        entity_type = ?, ownership_type = ?, funding_type = ?,
        referred_by_id = ?, product_details = ?, updated_at = NOW()
      WHERE id = ?`
    ).run(
      requestName, ownerName, owner_phone || null,
      entity_type || request.entity_type, ownership_type || request.ownership_type,
      nextFundingType, partnerId, JSON.stringify(productDetails || {}), req.params.id
    );
    await db.prepare('UPDATE companies SET company_name = ?, entity_type = ?, owner_name = ?, owner_phone = ? WHERE request_id = ?')
      .run(requestName, entity_type || request.entity_type, ownerName, owner_phone || null, req.params.id);
    let fundingEntityDocuments = [];
    if (request.funding_entity_id) {
      const fundingEntity = await db.prepare('SELECT required_documents FROM funding_entities WHERE id = ?').get(request.funding_entity_id);
      fundingEntityDocuments = parseRequiredDocuments(fundingEntity?.required_documents);
    }
    await ensureRequestDocuments(req.params.id, {
      ...request,
      entity_type: entity_type || request.entity_type,
      ownership_type: ownership_type || request.ownership_type,
      funding_type: nextFundingType,
      product_details: productDetails,
      fe_required_docs: fundingEntityDocuments,
    });
    const updated = parseRequestRow(await db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id));
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في تعديل الطلب' });
  }
});

// DELETE /api/requests/:id — admin hard delete
router.post('/bulk-delete', authMiddleware, async (req, res) => {
  try {
    if (!canDeleteRequests(req.user)) return res.status(403).json({ error: 'ليس لديك صلاحية حذف الطلبات' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'لم يتم تحديد طلبات للحذف' });

    let deletedCount = 0;

    for (const id of ids) {
      const request = await db.prepare('SELECT id FROM requests WHERE id = ?').get(id);
      if (!request) continue;
      await db.prepare('DELETE FROM status_history WHERE request_id = ?').run(id);
      await db.prepare('DELETE FROM request_messages WHERE request_id = ?').run(id);
      await db.prepare('DELETE FROM request_documents WHERE request_id = ?').run(id);
      await db.prepare('DELETE FROM requests WHERE id = ?').run(id);
      deletedCount += 1;
    }

    res.json({ message: `تم حذف ${deletedCount} طلب`, deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الحذف الجماعي' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (!canDeleteRequests(req.user)) return res.status(403).json({ error: 'ليس لديك صلاحية حذف الطلبات' });
    const request = await db.prepare('SELECT id FROM requests WHERE id = ?').get(req.params.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    await db.prepare('DELETE FROM status_history WHERE request_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM request_messages WHERE request_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM request_documents WHERE request_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
    res.json({ message: 'تم حذف الطلب' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

// POST /api/requests/:id/request-delete
router.post('/:id/request-delete', authMiddleware, async (req, res) => {
  try {
    const request = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (['approved', 'transferred', 'fees_received'].includes(request.status)) {
      return res.status(400).json({ error: 'لا يمكن حذف طلب تمت الموافقة عليه' });
    }
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'سبب الحذف مطلوب' });

    await db.prepare(`UPDATE requests SET status = 'delete_requested', delete_reason = ?, updated_at = NOW() WHERE id = ?`)
      .run(reason.trim(), req.params.id);
    await db.prepare('INSERT INTO status_history (request_id, status, note, created_by) VALUES (?, ?, ?, ?)')
      .run(req.params.id, 'delete_requested', `طلب حذف - السبب: ${reason.trim()}`, req.user.id);

    res.json({ message: 'تم إرسال طلب الحذف للمدير' });
  } catch (err) {
    res.status(500).json({ error: 'خطأ في إرسال طلب الحذف' });
  }
});

// GET /api/requests/clients-summary - list of companies submitted to funding
router.get('/clients-summary/all', authMiddleware, async (req, res) => {
  try {
    const clients = await db.prepare(`
      SELECT DISTINCT
        r.id,
        r.company_name,
        r.owner_name,
        r.owner_phone,
        r.entity_type,
        r.created_at,
        r.total_deposit,
        r.total_transfer,
        r.funding_entity_id,
        fe.name as funding_entity_name,
        r.status
      FROM requests r
      LEFT JOIN funding_entities fe ON r.funding_entity_id = fe.id
      WHERE r.user_id = ? AND r.status IN ('submitted','approved','transferred','fees_received')
      ORDER BY r.created_at DESC
    `).all(req.user.id);

    res.json(clients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في استرجاع البيانات' });
  }
});

module.exports = router;
