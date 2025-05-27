// frontend/src/hooks/useMondayContext.js
import { useContext, useEffect, useState } from 'react';
import { MondayContext } from '../context/MondayContext';

export const useMondayContext = () => {
  const context = useContext(MondayContext);
  
  if (!context) {
    throw new Error('useMondayContext must be used within MondayProvider');
  }
  
  return context;
};

// Hook to get board data
export const useBoardData = () => {
  const { monday, context } = useMondayContext();
  const [boardData, setBoardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!context.boardId) {
      setLoading(false);
      return;
    }

    const fetchBoardData = async () => {
      try {
        const query = `
          query GetBoard($boardId: [ID!]) {
            boards(ids: $boardId) {
              id
              name
              description
              columns {
                id
                title
                type
                settings_str
              }
              groups {
                id
                title
                color
                position
              }
            }
          }
        `;

        const response = await monday.api(query, {
          variables: { boardId: [context.boardId] }
        });

        if (response.data?.boards?.[0]) {
          setBoardData(response.data.boards[0]);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchBoardData();
  }, [monday, context.boardId]);

  return { boardData, loading, error };
};

// Hook to get available users
export const useAvailableUsers = () => {
  const { monday, context } = useMondayContext();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!context.boardId) {
      setLoading(false);
      return;
    }

    const fetchUsers = async () => {
      try {
        const query = `
          query GetUsers($boardId: [ID!]) {
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

        const response = await monday.api(query, {
          variables: { boardId: [context.boardId] }
        });

        if (response.data?.boards?.[0]?.subscribers) {
          setUsers(response.data.boards[0].subscribers);
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [monday, context.boardId]);

  return { users, loading };
};

// Hook to check permissions
export const usePermissions = () => {
  const { monday, context } = useMondayContext();
  const [permissions, setPermissions] = useState({
    canWrite: false,
    canDelete: false,
    canManageBoard: false,
    isGuest: false
  });

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const query = `
          query CheckPermissions {
            me {
              id
              is_guest
              account {
                tier
              }
            }
          }
        `;

        const response = await monday.api(query);
        const me = response.data?.me;

        if (me) {
          setPermissions({
            canWrite: !me.is_guest,
            canDelete: !me.is_guest,
            canManageBoard: !me.is_guest,
            isGuest: me.is_guest
          });
        }
      } catch (err) {
        console.error('Failed to check permissions:', err);
      }
    };

    checkPermissions();
  }, [monday]);

  return permissions;
};

// Hook for real-time updates
export const useRealtimeUpdates = (callback) => {
  const { monday } = useMondayContext();

  useEffect(() => {
    // Listen for board updates
    const unsubscribe = monday.listen('events', (res) => {
      if (res.type === 'board_communication') {
        callback(res.data);
      }
    });

    return () => {
      // Clean up listener
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [monday, callback]);
};