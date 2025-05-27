// frontend/src/components/OperationPreview.jsx
import React, { useState } from 'react';
import './OperationPreview.css';

const OperationPreview = ({ operation, onExecute, onCancel, isProcessing }) => {
  const [editedParams, setEditedParams] = useState(operation.parameters || {});
  const [showDetails, setShowDetails] = useState(false);

  const handleParamChange = (key, value) => {
    setEditedParams({
      ...editedParams,
      [key]: value
    });
  };

  const handleExecuteClick = () => {
    onExecute({
      ...operation,
      parameters: editedParams
    });
  };

  const getOperationIcon = (type) => {
    const icons = {
      'create_item': '➕',
      'update_item': '✏️',
      'delete_item': '🗑️',
      'move_item': '➡️',
      'duplicate_item': '📋',
      'assign_user': '👤',
      'create_board': '📊',
      'bulk_update': '🔄',
      'create_automation': '⚙️'
    };
    return icons[type] || '📌';
  };

  const getOperationDescription = () => {
    const { type, parameters } = operation;
    
    switch (type) {
      case 'create_item':
        return `Create new item "${parameters.itemName}" in ${parameters.groupName || 'board'}`;
      case 'update_item':
        return `Update item ${parameters.itemName || 'selected item'}`;
      case 'delete_item':
        return `Delete ${parameters.itemCount || 1} item(s)`;
      case 'move_item':
        return `Move items to ${parameters.targetGroup}`;
      case 'assign_user':
        return `Assign ${parameters.userName} to ${parameters.itemCount || 1} item(s)`;
      case 'bulk_update':
        return `Update ${parameters.itemCount} items`;
      case 'create_automation':
        return `Create automation: ${parameters.automationName}`;
      default:
        return `Perform ${type.replace(/_/g, ' ')}`;
    }
  };

  const renderParameterInput = (key, value, type) => {
    // Different input types based on parameter
    if (key === 'columnValues' && typeof value === 'object') {
      return (
        <div className="column-values-editor">
          {Object.entries(value).map(([colId, colValue]) => (
            <div key={colId} className="column-value-row">
              <label>{colId}:</label>
              <input
                type="text"
                value={colValue}
                onChange={(e) => handleParamChange('columnValues', {
                  ...value,
                  [colId]: e.target.value
                })}
              />
            </div>
          ))}
        </div>
      );
    }

    if (typeof value === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => handleParamChange(key, e.target.checked)}
        />
      );
    }

    return (
      <input
        type="text"
        value={value || ''}
        onChange={(e) => handleParamChange(key, e.target.value)}
        className="param-input"
      />
    );
  };

  return (
    <div className="operation-preview">
      <div className="preview-header">
        <div className="operation-icon">
          {getOperationIcon(operation.type)}
        </div>
        <div className="operation-info">
          <h3 className="operation-title">
            {getOperationDescription()}
          </h3>
          <p className="operation-type">
            Operation: {operation.type.replace(/_/g, ' ')}
          </p>
        </div>
        <div className="confidence-badge" data-confidence={
          operation.confidence > 80 ? 'high' : 
          operation.confidence > 60 ? 'medium' : 'low'
        }>
          {operation.confidence}% confident
        </div>
      </div>

      {operation.warnings && operation.warnings.length > 0 && (
        <div className="operation-warnings">
          <h4>⚠️ Warnings:</h4>
          <ul>
            {operation.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="preview-parameters">
        <div className="parameters-header">
          <h4>Parameters</h4>
          <button 
            className="toggle-details"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide' : 'Show'} Details
          </button>
        </div>
        
        {showDetails && (
          <div className="parameters-list">
            {Object.entries(editedParams).map(([key, value]) => (
              <div key={key} className="parameter-row">
                <label className="parameter-label">
                  {key.replace(/([A-Z])/g, ' $1').trim()}:
                </label>
                <div className="parameter-value">
                  {renderParameterInput(key, value, typeof value)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {operation.alternatives && operation.alternatives.length > 0 && (
        <div className="operation-alternatives">
          <p className="alternatives-title">Alternative interpretations:</p>
          <ul>
            {operation.alternatives.map((alt, index) => (
              <li key={index}>
                <button 
                  className="alternative-button"
                  onClick={() => onCancel()}
                >
                  {alt.description} ({alt.confidence}%)
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="preview-actions">
        <button 
          className="cancel-button"
          onClick={onCancel}
          disabled={isProcessing}
        >
          Cancel
        </button>
        <button 
          className="execute-button"
          onClick={handleExecuteClick}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <>
              <span className="spinner"></span>
              Executing...
            </>
          ) : (
            <>
              <span className="checkmark">✓</span>
              Execute Operation
            </>
          )}
        </button>
      </div>

      {operation.affectedItems && (
        <div className="affected-items">
          <p className="affected-count">
            This will affect {operation.affectedItems} item(s)
          </p>
        </div>
      )}
    </div>
  );
};

export default OperationPreview;