import React, { useState, useEffect } from 'react';

interface ConnectionStatus {
  moneypex: { connected: boolean; error?: string };
  lootmart: { connected: boolean; error?: string };
}

interface ConnectionStatusProps {
  onConnectionTest?: (status: ConnectionStatus) => void;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ onConnectionTest }) => {
  const [status, setStatus] = useState<ConnectionStatus>({
    moneypex: { connected: false },
    lootmart: { connected: false }
  });
  const [testing, setTesting] = useState(false);

  const testConnections = async () => {
    setTesting(true);
    
    try {
      // Test Moneypex connection
      const moneypexResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ action: 'testMoneypexConnection' }, (response) => {
          resolve(response || { success: false, error: 'No response' });
        });
      });

      // Test Lootmart connection
      const lootmartResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ action: 'testLootmartConnection' }, (response) => {
          resolve(response || { success: false, error: 'No response' });
        });
      });

      const newStatus: ConnectionStatus = {
        moneypex: { 
          connected: moneypexResult.success,
          error: moneypexResult.error
        },
        lootmart: { 
          connected: lootmartResult.success,
          error: lootmartResult.error
        }
      };

      setStatus(newStatus);
      
      if (onConnectionTest) {
        onConnectionTest(newStatus);
      }
    } catch (error) {
      console.error('Error testing connections:', error);
    } finally {
      setTesting(false);
    }
  };

  // Test connections on component mount
  useEffect(() => {
    testConnections();
  }, []);

  const getStatusIcon = (connected: boolean) => {
    return connected ? '✅' : '❌';
  };

  const getStatusText = (connected: boolean) => {
    return connected ? 'Connected' : 'Disconnected';
  };

  const getStatusClass = (connected: boolean) => {
    return connected ? 'status-connected' : 'status-disconnected';
  };

  return (
    <div className="connection-status">
      <h3>Connection Status</h3>
      
      <div className="status-grid">
        <div className={`status-item ${getStatusClass(status.moneypex.connected)}`}>
          <div className="status-header">
            <span className="status-icon">{getStatusIcon(status.moneypex.connected)}</span>
            <span className="status-name">Moneypex</span>
          </div>
          <div className="status-text">{getStatusText(status.moneypex.connected)}</div>
          {status.moneypex.error && (
            <div className="status-error">{status.moneypex.error}</div>
          )}
        </div>

        <div className={`status-item ${getStatusClass(status.lootmart.connected)}`}>
          <div className="status-header">
            <span className="status-icon">{getStatusIcon(status.lootmart.connected)}</span>
            <span className="status-name">Lootmart</span>
          </div>
          <div className="status-text">{getStatusText(status.lootmart.connected)}</div>
          {status.lootmart.error && (
            <div className="status-error">{status.lootmart.error}</div>
          )}
        </div>
      </div>

      <button 
        onClick={testConnections} 
        disabled={testing}
        className="test-connection-btn"
      >
        {testing ? 'Testing...' : 'Test Connections'}
      </button>
    </div>
  );
};

export default ConnectionStatus;
