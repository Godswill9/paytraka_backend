const XLSX = require('xlsx');

// Parse uploaded buffer (CSV or Excel) into array of objects
const parseImportFile = (buffer, originalName) => {
  const ext = originalName.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  }

  if (ext === 'xlsx') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  }

  throw new Error('Unsupported file format. Use .csv or .xlsx');
};

// Generate an Excel template buffer from headers
const generateTemplate = (headers, sheetName = 'Template') => {
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

// Generate Excel from array of objects
const generateExport = (data, sheetName = 'Export') => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

const CUSTOMER_HEADERS = ['name', 'email', 'phone', 'address', 'city', 'state', 'country', 'tax_id'];
const SUPPLIER_HEADERS = ['name', 'email', 'phone', 'address', 'city', 'state', 'country', 'tax_id', 'bank_name', 'account_number'];
const PRODUCT_HEADERS = ['name', 'description', 'unit_price', 'unit', 'category_id', 'tax_rate'];

module.exports = {
  parseImportFile,
  generateTemplate,
  generateExport,
  CUSTOMER_HEADERS,
  SUPPLIER_HEADERS,
  PRODUCT_HEADERS,
};
