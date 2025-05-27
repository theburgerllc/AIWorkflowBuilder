// frontend/src/components/AIAssistant.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useMondayContext } from '../hooks/useMondayContext';
import OperationPreview from './OperationPreview';
import ExecutionResults from './ExecutionResults';
import OperationHistory from './OperationHistory';
import apiClient from '../services/api-client';
import toast from 'react-hot-toast';
import './AIAssistant.css';

const AIAssistant = () => {
  const { context, monday } = useMondayContext();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentOperation, setCurrentOperation] = useState(null);
  const [executionResult, setExecutionResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const inputRef = useRef(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load operation history
  useEffect(() => {
    loadHistory();
  }, [context.boardId]);

  const loadHistory = async () => {
    try {
      const stored = await monday.storage.instance.getItem('operation_history');
      if (stored) {
        setHistory(JSON.parse(stored).slice(0, 10)); // Keep last 10
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  };

  const saveToHistory = async (operation) => {
    const newHistory = [operation, ...history].slice(0, 10);
    setHistory(newHistory);
    try {
      await monday.storage.instance.setItem('operation_history', JSON.stringify(newHistory));
    } catch (error) {
      console.error('Failed to save history:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    setCurrentOperation(null);
    setExecutionResult(null);

    try {
      // Step 1: Analyze the request
      const analysisResult = await apiClient.analyzeRequest({
        text: input,
        context: {
          boardId: context.boardId,
          userId: context.userId,
          itemId: context.itemId,
          groupId: context.groupId
        }
      });

      if (!analysisResult.success) {
        throw new Error(analysisResult.error);
      }

      // Show operation preview
      setCurrentOperation(analysisResult.operation);
      setSuggestions(analysisResult.suggestions || []);

    } catch (error) {
      toast.error(error.message || 'Failed to analyze request');
      console.error('Analysis error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecute = async () => {
    if (!currentOperation) return;

    setIsProcessing(true);
    
    try {
      // Execute the operation
      const result = await apiClient.executeOperation(currentOperation);
      
      if (result.success) {
        toast.success('Operation completed successfully!');
        setExecutionResult(result);
        
        // Save to history
        await saveToHistory({
          input: input,
          operation: currentOperation,
          result: result,
          timestamp: new Date().toISOString()
        });
        
        // Clear input for next operation
        setInput('');
        inputRef.current?.focus();
      } else {
        throw new Error(result.error);
      }
      
    } catch (error) {
      toast.error(error.message || 'Failed to execute operation');
      setExecutionResult({
        success: false,
        error: error.message
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    setCurrentOperation(null);
    setExecutionResult(null);
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const handleSuggestionClick = (suggestion) => {
    setInput(suggestion);
    inputRef.current?.focus();
  };

  const handleHistoryReplay = (historyItem) => {
    setInput(historyItem.input);
    setCurrentOperation(historyItem.operation);
  };

  const handleKeyDown = (e) => {
    // Ctrl/Cmd + Enter to submit
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSubmit(e);
    }
    // Escape to cancel
    if (e.key === 'Escape' && currentOperation) {
      handleCancel();
    }
  };

  return (
    <div className="ai-assistant">
      <div className="assistant-input-section">
        <form onSubmit={handleSubmit} className="input-form">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What would you like to do? For example: 'Create a new task called Website Redesign' or 'Move all completed items to Done group'"
              className="assistant-input"
              rows={3}
              disabled={isProcessing}
            />
            <div className="input-actions">
              <span className="input-hint">
                Press Ctrl+Enter to submit
              </span>
              <button
                type="submit"
                className="submit-button"
                disabled={!input.trim() || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <span className="spinner"></span>
                    Processing...
                  </>
                ) : (
                  'Analyze'
                )}
              </button>
            </div>
          </div>
        </form>

        {suggestions.length > 0 && !currentOperation && (
          <div className="suggestions">
            <p className="suggestions-title">Did you mean:</p>
            <div className="suggestions-list">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  className="suggestion-button"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {currentOperation && !executionResult && (
        <OperationPreview
          operation={currentOperation}
          onExecute={handleExecute}
          onCancel={handleCancel}
          isProcessing={isProcessing}
        />
      )}

      {executionResult && (
        <ExecutionResults
          result={executionResult}
          operation={currentOperation}
          onClose={() => {
            setExecutionResult(null);
            setCurrentOperation(null);
          }}
        />
      )}

      {history.length > 0 && !currentOperation && !executionResult && (
        <OperationHistory
          history={history}
          onReplay={handleHistoryReplay}
          onClear={() => {
            setHistory([]);
            monday.storage.instance.setItem('operation_history', '[]');
          }}
        />
      )}

      <div className="assistant-footer">
        <div className="confidence-indicator">
          <span className="label">AI Confidence:</span>
          <div className="confidence-bar">
            <div 
              className="confidence-fill"
              style={{
                width: `${currentOperation?.confidence || 0}%`,
                backgroundColor: currentOperation?.confidence > 80 ? '#00ca72' : 
                               currentOperation?.confidence > 60 ? '#fdab3d' : '#e2445c'
              }}
            />
          </div>
          <span className="confidence-value">
            {currentOperation?.confidence || 0}%
          </span>
        </div>
      </div>
    </div>
  );
};

export default AIAssistant;