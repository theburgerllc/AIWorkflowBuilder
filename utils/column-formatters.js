// utils/column-formatters.js

/**
 * Format column values according to Monday.com API requirements
 * @param {string} columnType - The type of column
 * @param {any} value - The value to format
 * @returns {any} Formatted value for Monday.com API
 */
export function formatColumnValue(columnType, value) {
  const formatters = {
    // Text columns
    'text': (val) => {
      if (val === null || val === undefined) return '';
      return String(val);
    },
    
    'long_text': (val) => {
      if (val === null || val === undefined) return '';
      return String(val);
    },
    
    // Number column
    'numbers': (val) => {
      if (val === null || val === undefined || val === '') return '';
      const num = parseFloat(val);
      return isNaN(num) ? '' : String(num);
    },
    
    // Status column
    'status': (val) => {
      if (typeof val === 'string') {
        return { label: val };
      }
      if (val && typeof val === 'object' && val.label) {
        return { label: val.label };
      }
      return null;
    },
    
    // People column
    'people': (val) => {
      if (!val) return { personsAndTeams: [] };
      
      // Single ID
      if (typeof val === 'number' || typeof val === 'string') {
        return {
          personsAndTeams: [{
            id: parseInt(val),
            kind: 'person'
          }]
        };
      }
      
      // Array of IDs
      if (Array.isArray(val)) {
        return {
          personsAndTeams: val.map(id => ({
            id: parseInt(id),
            kind: 'person'
          }))
        };
      }
      
      // Already formatted
      if (val.personsAndTeams) {
        return val;
      }
      
      return { personsAndTeams: [] };
    },
    
    // Date column
    'date': (val) => {
      if (!val) return null;
      
      // String date
      if (typeof val === 'string') {
        // Check if already in correct format
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          return { date: val };
        }
        
        // Try to parse date
        try {
          const date = new Date(val);
          const formatted = date.toISOString().split('T')[0];
          return { date: formatted };
        } catch {
          return null;
        }
      }
      
      // Date object
      if (val instanceof Date) {
        return { date: val.toISOString().split('T')[0] };
      }
      
      // Already formatted
      if (val.date) {
        return val;
      }
      
      return null;
    },
    
    // Timeline column
    'timeline': (val) => {
      if (!val) return null;
      
      if (val.from && val.to) {
        return {
          from: formatDate(val.from),
          to: formatDate(val.to)
        };
      }
      
      return null;
    },
    
    // Checkbox column
    'checkbox': (val) => {
      if (val === null || val === undefined) return null;
      
      if (typeof val === 'boolean') {
        return { checked: val ? 'true' : 'false' };
      }
      
      if (typeof val === 'string') {
        return { checked: val.toLowerCase() === 'true' ? 'true' : 'false' };
      }
      
      if (val.checked !== undefined) {
        return { checked: val.checked ? 'true' : 'false' };
      }
      
      return { checked: 'false' };
    },
    
    // Email column
    'email': (val) => {
      if (!val) return '';
      
      if (typeof val === 'object' && val.email) {
        return val.email;
      }
      
      return String(val);
    },
    
    // Phone column
    'phone': (val) => {
      if (!val) return '';
      
      if (typeof val === 'object' && val.phone) {
        return val.phone;
      }
      
      return String(val);
    },
    
    // Link column
    'link': (val) => {
      if (!val) return null;
      
      if (typeof val === 'string') {
        return {
          url: val,
          text: extractDomain(val)
        };
      }
      
      if (val.url) {
        return {
          url: val.url,
          text: val.text || extractDomain(val.url)
        };
      }
      
      return null;
    },
    
    // Dropdown column
    'dropdown': (val) => {
      if (!val) return null;
      
      // Single value
      if (typeof val === 'string') {
        return { labels: [val] };
      }
      
      // Array of values
      if (Array.isArray(val)) {
        return { labels: val };
      }
      
      // Already formatted
      if (val.labels) {
        return val;
      }
      
      return null;
    },
    
    // Tags column
    'tags': (val) => {
      if (!val) return null;
      
      // Array of tag IDs
      if (Array.isArray(val)) {
        return { tag_ids: val.map(id => parseInt(id)) };
      }
      
      // Already formatted
      if (val.tag_ids) {
        return val;
      }
      
      return null;
    },
    
    // Rating column
    'rating': (val) => {
      if (val === null || val === undefined) return null;
      
      const rating = parseInt(val);
      if (isNaN(rating) || rating < 0 || rating > 5) {
        return null;
      }
      
      return rating;
    },
    
    // File column
    'file': (val) => {
      // File columns are handled differently
      // They require file upload through separate API
      return null;
    }
  };
  
  const formatter = formatters[columnType];
  if (!formatter) {
    console.warn(`No formatter for column type: ${columnType}`);
    return value;
  }
  
  return formatter(value);
}

/**
 * Validate column values before formatting
 * @param {string} columnType - The type of column
 * @param {any} value - The value to validate
 * @returns {object} Validation result
 */
export function validateColumnValue(columnType, value) {
  const validators = {
    'text': (val) => {
      if (typeof val !== 'string' && val !== null && val !== undefined) {
        return { valid: false, error: 'Text value must be a string' };
      }
      return { valid: true };
    },
    
    'numbers': (val) => {
      if (val !== '' && val !== null && val !== undefined) {
        const num = parseFloat(val);
        if (isNaN(num)) {
          return { valid: false, error: 'Invalid number format' };
        }
      }
      return { valid: true };
    },
    
    'email': (val) => {
      if (val && typeof val === 'string') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(val)) {
          return { valid: false, error: 'Invalid email format' };
        }
      }
      return { valid: true };
    },
    
    'date': (val) => {
      if (val) {
        const dateStr = typeof val === 'string' ? val : val.date;
        if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          return { valid: false, error: 'Date must be in YYYY-MM-DD format' };
        }
      }
      return { valid: true };
    },
    
    'checkbox': (val) => {
      if (val !== null && val !== undefined) {
        const checked = typeof val === 'object' ? val.checked : val;
        if (typeof checked !== 'boolean' && checked !== 'true' && checked !== 'false') {
          return { valid: false, error: 'Checkbox value must be boolean' };
        }
      }
      return { valid: true };
    },
    
    'rating': (val) => {
      if (val !== null && val !== undefined) {
        const rating = parseInt(val);
        if (isNaN(rating) || rating < 0 || rating > 5) {
          return { valid: false, error: 'Rating must be between 0 and 5' };
        }
      }
      return { valid: true };
    }
  };
  
  const validator = validators[columnType] || (() => ({ valid: true }));
  return validator(value);
}

/**
 * Helper function to format dates
 * @private
 */
function formatDate(dateValue) {
  if (!dateValue) return null;
  
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return dateValue;
  }
  
  try {
    const date = new Date(dateValue);
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Helper function to extract domain from URL
 * @private
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Batch format multiple column values
 * @param {object} columns - Board columns info
 * @param {object} values - Column values to format
 * @returns {object} Formatted values
 */
export function formatColumnValues(columns, values) {
  const formatted = {};
  
  for (const [columnId, value] of Object.entries(values)) {
    const column = columns.find(c => c.id === columnId);
    if (column) {
      const formattedValue = formatColumnValue(column.type, value);
      if (formattedValue !== null && formattedValue !== undefined) {
        formatted[columnId] = formattedValue;
      }
    }
  }
  
  return formatted;
}

/**
 * Parse column value from Monday.com format to simple format
 * @param {string} columnType - The type of column
 * @param {string} value - The JSON string value from Monday.com
 * @returns {any} Parsed value
 */
export function parseColumnValue(columnType, value) {
  if (!value) return null;
  
  try {
    const parsed = JSON.parse(value);
    
    switch (columnType) {
      case 'status':
        return parsed.label || null;
        
      case 'people':
        return parsed.personsAndTeams?.map(p => p.id) || [];
        
      case 'date':
        return parsed.date || null;
        
      case 'checkbox':
        return parsed.checked === 'true';
        
      case 'dropdown':
        return parsed.labels || [];
        
      case 'link':
        return parsed.url || null;
        
      default:
        return parsed;
    }
  } catch {
    return value;
  }
}