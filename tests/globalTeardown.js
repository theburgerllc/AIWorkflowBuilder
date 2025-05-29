// Global test teardown
module.exports = async () => {
  console.log('Global test teardown started...');

  // Force cleanup any remaining handles
  if (global.gc) {
    global.gc();
  }

  // Clear all timers (if available)
  if (typeof clearTimeout.clearAll === 'function') {
    clearTimeout.clearAll();
  }
  if (typeof clearInterval.clearAll === 'function') {
    clearInterval.clearAll();
  }

  // Force close any remaining HTTP connections
  if (process._getActiveHandles) {
    const handles = process._getActiveHandles();
    handles.forEach(handle => {
      if (handle && typeof handle.close === 'function') {
        try {
          handle.close();
        } catch (e) {
          // Ignore errors during forced cleanup
        }
      }
    });
  }

  // Give extra time for cleanup
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('Global test teardown completed');
};
