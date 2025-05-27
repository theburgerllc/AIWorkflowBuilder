// frontend/src/components/ExecutionResults.jsx
import React, { useState } from 'react';
import { useMondayContext } from '../hooks/useMondayContext';
import apiClient from '../services/api-client';
import toast from 'react-hot-toast';
import './ExecutionResults.css';

const ExecutionResults = ({ result, operation, onClose }) => {
  const { monday } = useMondayContext();
  const [isUndoing, setIsUndoing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleUndo = async () => {
    if (!result.undoable || isUndoing) return;

    setIsUndoing(true);
    try {
      const undoResult = await apiClient.undoOperation({
        operationId: result.operationId,
        undoData: result.undoData
      });

      if (undoResult.success) {
        toast.success('Operation undone successfully');
        onClose();
      } else {
        throw new Error(undoResult.error);
      }
    } catch (error) {
      toast.error(`Failed to undo: ${error.message}`);
    } finally {
      setIsUndoing(false);
    }
  };

  const handleViewInMonday = () => {
    if (result.itemId) {
      monday.execute('openItemCard', { itemId: result.itemId });
    } else if (result.boardId) {
      monday.execute('openBoard', { boardId: result.boardId });
    }
  };

  const getResultIcon = () => {
    if (!result.success) return '❌';
    
    switch (operation.type) {
      case 'create_item': return '✅';
      case 'update_item': return '✏️';
      case 'delete_item': return '🗑️';
      case 'move_item': return '➡️';
      case 'duplicate_item': return '📋';
      case 'assign_user': return '👤';
      case 'create_automation': return '⚙️';
      default: return '✅';
    }
  };

  const renderSuccessDetails = () => {
    if (!result.details) return null;

    return (
      <div className="result-details">
        {result.itemId && (
          <div className="detail-row">
            <span className="detail-label">Item ID:</span>
            <span className="detail-value">{result.itemId}</span>
          </div>
        )}
        {result.itemName && (
          <div className="detail-row">
            <span className="detail-label">Item Name:</span>
            <span className="detail-value">{result.itemName}</span>
          </div>
        )}
        {result.affectedCount && (
          <div className="detail-row">
            <span className="detail-label">Items Affected:</span>
            <span className="detail-value">{result.affectedCount}</span>
          </div>
        )}
        {result.details.map((detail, index) => (
          <div key={index} className="detail-row">
            <span className="detail-label">{detail.label}:</span>
            <span className="detail-value">{detail.value}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderErrorDetails = () => {
    if (!result.error) return null;

    return (
      <div className="error-details">
        <h4>Error Details:</h4>
        <p className="error-message">{result.error}</p>
        {result.errorDetails && (
          <pre className="error-stack">
            {JSON.stringify(result.errorDetails, null, 2)}
          </pre>
        )}
        {result.suggestions && (
          <div className="error-suggestions">
            <h5>Suggestions:</h5>
            <ul>
              {result.suggestions.map((suggestion, index) => (
                <li key={index}>{suggestion}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderBulkResults = () => {
    if (!result.bulkResults) return null;

    const { successful, failed } = result.bulkResults;

    return (
      <div className="bulk-results">
        <div className="bulk-summary">
          <div className="summary-stat success">
            <span className="stat-value">{successful.length}</span>
            <span className="stat-label">Successful</span>
          </div>
          <div className="summary-stat error">
            <span className="stat-value">{failed.length}</span>
            <span className="stat-label">Failed</span>
          </div>
        </div>

        {failed.length > 0 && showDetails && (
          <div className="failed-items">
            <h5>Failed Items:</h5>
            <ul>
              {failed.map((item, index) => (
                <li key={index}>
                  {item.itemId}: {item.error}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`execution-results ${result.success ? 'success' : 'error'}`}>
      <div className="results-header">
        <div className="result-icon">
          {getResultIcon()}
        </div>
        <div className="result-info">
          <h3 className="result-title">
            {result.success ? 'Operation Completed' : 'Operation Failed'}
          </h3>
          <p className="result-message">
            {result.message || (result.success ? 
              'The operation was executed successfully.' : 
              'The operation could not be completed.'
            )}
          </p>
        </div>
      </div>

      {result.success ? renderSuccessDetails() : renderErrorDetails()}
      {renderBulkResults()}

      <div className="results-actions">
        {result.success && (
          <>
            {result.undoable && (
              <button 
                className="undo-button"
                onClick={handleUndo}
                disabled={isUndoing}
              >
                {isUndoing ? (
                  <>
                    <span className="spinner"></span>
                    Undoing...
                  </>
                ) : (
                  <>
                    <span className="undo-icon">↶</span>
                    Undo Operation
                  </>
                )}
              </button>
            )}
            
            {(result.itemId || result.boardId) && (
              <button 
                className="view-button"
                onClick={handleViewInMonday}
              >
                <span className="view-icon">👁️</span>
                View in Monday
              </button>
            )}
          </>
        )}

        {result.bulkResults && (
          <button 
            className="details-button"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} Details
          </button>
        )}

        <button 
          className="close-button"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {result.nextSteps && result.nextSteps.length > 0 && (
        <div className="next-steps">
          <h4>Suggested Next Steps:</h4>
          <ul>
            {result.nextSteps.map((step, index) => (
              <li key={index}>
                <button 
                  className="next-step-button"
                  onClick={() => {
                    // Trigger new operation with suggested step
                    onClose();
                  }}
                >
                  {step}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ExecutionResults;