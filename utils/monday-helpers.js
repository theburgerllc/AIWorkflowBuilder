// utils/monday-helpers.js
import { mondayClient } from '../config/monday-client.js';

/**
 * Monday.com API helper utilities
 */

// Cache for frequently accessed data
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get user by email
 * @param {string} email - User email
 * @returns {object} User data or null
 */
export async function getUserByEmail(email) {
  const cacheKey = `user_email_${email}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const query = `
      query GetUserByEmail($email: String!) {
        users(emails: [$email]) {
          id
          name
          email
          photo_thumb
          is_guest
          teams {
            id
            name
          }
        }
      }
    `;

    const result = await mondayClient.request(query, { email });
    const user = result.data.users[0] || null;

    if (user) {
      setCache(cacheKey, user);
    }

    return user;
  } catch (error) {
    console.error('Failed to get user by email:', error);
    return null;
  }
}

/**
 * Get user by name (fuzzy search)
 * @param {string} name - User name
 * @param {string} boardId - Board ID for context
 * @returns {array} Matching users
 */
export async function getUsersByName(name, boardId) {
  try {
    const query = `
      query GetBoardUsers($boardId: [ID!]) {
        boards(ids: $boardId) {
          subscribers {
            id
            name
            email
            photo_thumb
          }
        }
      }
    `;

    const result = await mondayClient.request(query, { boardId: [boardId] });
    const users = result.data.boards[0]?.subscribers || [];

    // Fuzzy match on name
    const searchName = name.toLowerCase();
    return users.filter(user =>
      user.name.toLowerCase().includes(searchName)
    );
  } catch (error) {
    console.error('Failed to search users by name:', error);
    return [];
  }
}

/**
 * Get group by name
 * @param {string} boardId - Board ID
 * @param {string} groupName - Group name
 * @returns {object} Group data or null
 */
export async function getGroupByName(boardId, groupName) {
  try {
    const groups = await getBoardGroups(boardId);

    // Try exact match first
    let group = groups.find(g => g.title === groupName);

    // Try case-insensitive match
    if (!group) {
      const searchName = groupName.toLowerCase();
      group = groups.find(g => g.title.toLowerCase() === searchName);
    }

    // Try partial match
    if (!group) {
      const searchName = groupName.toLowerCase();
      group = groups.find(g => g.title.toLowerCase().includes(searchName));
    }

    return group || null;
  } catch (error) {
    console.error('Failed to get group by name:', error);
    return null;
  }
}

/**
 * Get board groups
 * @param {string} boardId - Board ID
 * @returns {array} Groups array
 */
export async function getBoardGroups(boardId) {
  const cacheKey = `board_groups_${boardId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const query = `
      query GetBoardGroups($boardId: [ID!]) {
        boards(ids: $boardId) {
          groups {
            id
            title
            color
            position
            archived
          }
        }
      }
    `;

    const result = await mondayClient.request(query, { boardId: [boardId] });
    const groups = result.data.boards[0]?.groups || [];

    // Filter out archived groups by default
    const activeGroups = groups.filter(g => !g.archived);

    setCache(cacheKey, activeGroups);
    return activeGroups;
  } catch (error) {
    console.error('Failed to get board groups:', error);
    return [];
  }
}

/**
 * Get column by name
 * @param {string} boardId - Board ID
 * @param {string} columnName - Column name
 * @returns {object} Column data or null
 */
export async function getColumnByName(boardId, columnName) {
  try {
    const columns = await getBoardColumns(boardId);

    // Try exact match first
    let column = columns.find(c => c.title === columnName);

    // Try case-insensitive match
    if (!column) {
      const searchName = columnName.toLowerCase();
      column = columns.find(c => c.title.toLowerCase() === searchName);
    }

    return column || null;
  } catch (error) {
    console.error('Failed to get column by name:', error);
    return null;
  }
}

/**
 * Get board columns
 * @param {string} boardId - Board ID
 * @returns {array} Columns array
 */
export async function getBoardColumns(boardId) {
  const cacheKey = `board_columns_${boardId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const query = `
      query GetBoardColumns($boardId: [ID!]) {
        boards(ids: $boardId) {
          columns {
            id
            title
            type
            settings_str
            archived
          }
        }
      }
    `;

    const result = await mondayClient.request(query, { boardId: [boardId] });
    const columns = result.data.boards[0]?.columns || [];

    // Filter out archived columns
    const activeColumns = columns.filter(c => !c.archived);

    setCache(cacheKey, activeColumns);
    return activeColumns;
  } catch (error) {
    console.error('Failed to get board columns:', error);
    return [];
  }
}

/**
 * Get status column labels
 * @param {string} boardId - Board ID
 * @param {string} columnId - Column ID
 * @returns {array} Status labels
 */
export async function getStatusLabels(boardId, columnId) {
  try {
    const columns = await getBoardColumns(boardId);
    const statusColumn = columns.find(c => c.id === columnId && c.type === 'status');

    if (!statusColumn || !statusColumn.settings_str) {
      return [];
    }

    const settings = JSON.parse(statusColumn.settings_str);
    return Object.values(settings.labels || {});
  } catch (error) {
    console.error('Failed to get status labels:', error);
    return [];
  }
}

/**
 * Search items by name
 * @param {string} boardId - Board ID
 * @param {string} searchTerm - Search term
 * @returns {array} Matching items
 */
export async function searchItems(boardId, searchTerm) {
  try {
    const query = `
      query SearchItems($boardId: [ID!]) {
        boards(ids: $boardId) {
          items_page(limit: 50) {
            items {
              id
              name
              group {
                id
                title
              }
              column_values {
                id
                text
              }
            }
          }
        }
      }
    `;

    const result = await mondayClient.request(query, { boardId: [boardId] });
    const items = result.data.boards[0]?.items_page?.items || [];

    // Filter items by search term
    const search = searchTerm.toLowerCase();
    return items.filter(item =>
      item.name.toLowerCase().includes(search)
    );
  } catch (error) {
    console.error('Failed to search items:', error);
    return [];
  }
}

/**
 * Get board templates
 * @returns {array} Available templates
 */
export async function getBoardTemplates() {
  const cacheKey = 'board_templates';
  const cached = getFromCache(cacheKey);
  if (cached) return cached;

  try {
    const query = `
      query {
        boards(limit: 50) {
          id
          name
          description
          board_kind
          columns {
            id
            title
            type
          }
        }
      }
    `;

    const response = await mondayApiRequest(query, {}, accessToken);
    const templates = response.data.boards || [];

    setCache(cacheKey, templates, 3600000); // Cache for 1 hour
    return templates;
  } catch (error) {
    logger.error('Error fetching board templates:', error);
    return [];
  }
};