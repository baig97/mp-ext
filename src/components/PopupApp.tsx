import React, { useState, useEffect } from 'react';
import { supabase, type Merchant } from '../_shared/supabase-config';
import LoginForm from './LoginForm';
import NotificationSubscription from './NotificationSubscription';

const PopupApp: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated
    const checkAuth = async () => {
      try {
        console.log('Starting auth check...');
        const { data: { user } } = await supabase.auth.getUser();
        console.log('Auth check result:', user);
        console.log('User keys:', user ? Object.keys(user) : 'no user');
        
        if (user) {
          setUser(user);
          // Get session separately for initial auth check
          const { data: { session } } = await supabase.auth.getSession();
          // Pass the user object and session directly
          await fetchMerchantData(user.email!, user, session);
        }
      } catch (error) {
        console.error('Error during auth check:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes - following Supabase best practices
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.email);
        console.log('Session user keys:', session?.user ? Object.keys(session.user) : 'no user');
        
        // Quick synchronous operations only in callback
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setMerchant(null);
        }

        // Dispatch async operations after callback finishes
        setTimeout(async () => {
          if (event === 'SIGNED_IN' && session?.user) {
            // Fetch merchant data after callback completes
            await fetchMerchantData(session.user.email!, session.user, session);
            // Sync auth with background worker
            try {
              await new Promise<void>((resolve) => {
                chrome.runtime.sendMessage({ action: 'syncAuth' }, (response) => {
                  if (response?.success) {
                    console.log('✅ Auth synced with background worker');
                  } else {
                    console.error('❌ Failed to sync auth with background worker:', response?.error);
                  }
                  resolve();
                });
              });
            } catch (error) {
              console.error('❌ Error syncing auth:', error);
            }
          }
        }, 0);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkIfShouldValidateToken = async (): Promise<boolean> => {
    try {
      // Check if we've already validated the token in this session
      const result = await chrome.storage.local.get(['tokenValidatedForSession', 'extensionVersion']);
      const currentVersion = chrome.runtime.getManifest().version;
      
      // If we've already validated in this session, don't validate again
      if (result.tokenValidatedForSession && result.extensionVersion === currentVersion) {
        console.log('Token already validated for this session');
        return false;
      }
      
      // If extension version changed, we should validate
      if (result.extensionVersion !== currentVersion) {
        console.log('Extension version changed, will validate token');
        await chrome.storage.local.set({ extensionVersion: currentVersion });
        return true;
      }
      
      // If no previous validation record, validate once
      if (!result.tokenValidatedForSession) {
        console.log('First popup load, will validate token');
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking token validation status:', error);
      return false; // Don't validate if we can't check
    }
  };

  const fetchMerchantData = async (email: string, userObj?: any, sessionObj?: any) => {
    try {
      console.log('Fetching merchant data for:', email);
      const currentUser = userObj || user;
      console.log('User object:', currentUser);
      console.log('User keys:', currentUser ? Object.keys(currentUser) : 'no user');
      
      if (!currentUser?.id) {
        console.error('No user.id available');
        console.log('Available user properties:', currentUser);
        return;
      }

      console.log('Using Supabase JS client with id equality and store join...');

      // Use Supabase JS client with the join query for store data
      const { data, error } = await supabase
        .from('merchants')
        .select(`
          *,
          store:stores(name)
        `)
        .eq('id', currentUser.id)
        .abortSignal(AbortSignal.timeout(5000))
        .single();

      console.log('Query completed:', { data, error });

      if (error) {
        if (error.code === 'PGRST116') {
          console.log('No merchant found for this user ID');
          setMerchant(null);
          return;
        }
        console.error('Error fetching merchant:', error);
        return;
      }

      if (!data) {
        console.log('No merchant data found');
        setMerchant(null);
        return;
      }

      console.log('Final merchant data:', data);
      setMerchant(data);

      // Only auto-validate FCM token if this is a fresh extension install/update
      // Check if we should validate FCM token (only on extension install/update)
      const shouldValidateToken = await checkIfShouldValidateToken();
      if (shouldValidateToken && data.subscribed_to_notifications && data.fcm_token) {
        console.log('Extension was recently installed/updated, validating FCM token...');
        await validateAndUpdateFCMToken(data);
        // Mark that we've validated the token for this session
        await chrome.storage.local.set({ tokenValidatedForSession: true });
      }
    } catch (error: any) {
      console.error('Error fetching merchant data:', error);
      if (error.name === 'AbortError') {
        console.error('Request timed out');
      }
    }
  };

  const validateAndUpdateFCMToken = async (merchantData: Merchant) => {
    try {
      // Get current FCM token from Firebase
      const response = await new Promise<{ success: boolean; token?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ action: 'getFCMToken' }, (response) => {
          resolve(response || { success: false });
        });
      });

      if (!response.success || !response.token) {
        console.log('Could not get current FCM token for validation');
        return;
      }

      const currentToken = response.token;
      const existingToken = merchantData.fcm_token;

      if (existingToken === currentToken) {
        console.log('✅ FCM token is still valid');
        return;
      }

      console.log('🔄 FCM token changed, updating automatically...');
      
      // Update with new token
      const { data, error } = await supabase
        .from('merchants')
        .update({
          fcm_token: currentToken,
        })
        .eq('id', merchantData.id)
        .select(`
          *
        `)
        .single();

      if (error) {
        console.error('Failed to update FCM token:', JSON.stringify(error, null, 2));
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        return;
      }

      console.log('✅ FCM token updated automatically');
      setMerchant(data);
    } catch (error) {
      console.error('Error validating FCM token:', error);
    }
  };

  const handleLogin = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      
      // User state will be updated by the auth listener
    } catch (error: any) {
      throw new Error(error.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleSubscribe = async () => {
    try {
      console.log('Attempting to subscribe to notifications...');

      // Get FCM token from background script (service worker)
      const response = await new Promise<{ success: boolean; token?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ action: 'getFCMToken' }, (response) => {
          resolve(response);
        });
      });

      if (!response.success || !response.token) {
        throw new Error(response.error || 'Failed to get FCM token');
      }

      const currentToken = response.token;
      console.log('Current FCM token received:', currentToken);

      // Check if token is different from the one stored in database
      const existingToken = merchant?.fcm_token;
      console.log('Existing FCM token in DB:', existingToken);

      if (existingToken === currentToken) {
        console.log('FCM token unchanged, no update needed');
        // Just update subscription status if not already subscribed
        if (!merchant?.subscribed_to_notifications) {
          const { data, error } = await supabase
            .from('merchants')
            .update({
              subscribed_to_notifications: true
            })
            .eq('id', user.id)
            .select(`*`)
            .single();

          if (error) {
            console.error('Failed to update subscription status:', JSON.stringify(error, null, 2));
            console.error('Error details:', {
              code: error.code,
              message: error.message,
              details: error.details,
              hint: error.hint
            });
            throw error;
          }
          setMerchant(data);
          console.log('Subscription status updated');
        }
        return;
      }

      console.log('FCM token changed, updating in database...');
      
      // Update merchant record with new FCM token
      const { data, error } = await supabase
        .from('merchants')
        .update({
          fcm_token: currentToken,
          subscribed_to_notifications: true,
        })
        .eq('id', user.id)
        .select(`*`)
        .single();

      if (error) {
        console.error('Failed to update FCM token in handleSubscribe:', JSON.stringify(error, null, 2));
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }

      setMerchant(data);
      console.log('Successfully updated FCM token and subscription status');
    } catch (error: any) {
      console.error('Subscription error:', error);
      throw error;
    }
  };

  const testBackgroundScript = async () => {
    try {
      console.log('🏓 Testing background script...');
      const response = await new Promise<{ success: boolean; message?: string }>((resolve) => {
        chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
          resolve(response || { success: false });
        });
      });
      
      if (response.success) {
        console.log('✅ Background script is alive:', response.message);
        alert('✅ Background script is responding!');
      } else {
        console.log('❌ Background script not responding');
        alert('❌ Background script not responding');
      }
    } catch (error) {
      console.error('❌ Error testing background script:', error);
      alert('❌ Error testing background script');
    }
  };

  const viewServiceWorkerLogs = async () => {
    try {
      const response = await new Promise<{ success: boolean; logs?: any[] }>((resolve) => {
        chrome.runtime.sendMessage({ action: 'getLogs' }, (response) => {
          resolve(response || { success: false });
        });
      });
      
      if (response.success && response.logs) {
        const logs = response.logs;
        let logHtml = `
          <div style="font-family: monospace; padding: 20px; background: #faf9f8;">
            <h3 style="color: #1e2951; margin-bottom: 20px;">Service Worker Logs (${logs.length} entries)</h3>
        `;
        
        logs.forEach(log => {
          const color = log.type === 'START' ? '#22c55e' : 
                       log.type === 'STOP' ? '#ef4444' : 
                       log.type === 'PUSH' ? '#f4d049' : '#6b7280';
          
          logHtml += `
            <div style="margin-bottom: 10px; padding: 8px; background: white; border-left: 4px solid ${color}; border-radius: 4px;">
              <strong style="color: ${color};">[${log.type}]</strong> 
              <span style="color: #6b7280; font-size: 12px;">${log.timestamp}</span><br>
              <span style="color: #1e2951;">${log.message}</span>
              ${log.data ? `<pre style="color: #6b7280; font-size: 11px; margin: 5px 0 0 0;">${JSON.stringify(log.data, null, 2)}</pre>` : ''}
            </div>
          `;
        });
        
        logHtml += '</div>';
        
        const logsWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes');
        if (logsWindow) {
          logsWindow.document.write(`
            <html>
              <head><title>Service Worker Logs</title></head>
              <body style="margin: 0;">${logHtml}</body>
            </html>
          `);
        }
      } else {
        alert('❌ No logs available or failed to fetch logs');
      }
    } catch (error) {
      console.error('❌ Error fetching logs:', error);
      alert('❌ Error fetching logs');
    }
  };

  if (loading) {
    return (
      <div className="popup-container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="popup-container">
        <LoginForm onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="popup-container">
      <div className="header">
        <h2>LootMart Notifications</h2>
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>
      
      <div className="user-info">
        <p>Welcome, {merchant?.full_name || user.email}</p>
        {merchant?.store?.name && (
          <p className="store-name">{merchant.store.name}</p>
        )}
      </div>

      {/* Debug section - remove in production */}
      <div style={{ marginBottom: '15px', padding: '10px', background: '#f0f0f1', borderRadius: '6px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button 
            onClick={testBackgroundScript}
            style={{
              background: '#f4d049',
              color: '#0d1421',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            🔧 Test SW
          </button>
          <button 
            onClick={viewServiceWorkerLogs}
            style={{
              background: '#22c55e',
              color: 'white',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            📋 View Logs
          </button>
        </div>
      </div>

      {!merchant?.email_confirmed ? (
        <div className="email-not-confirmed">
          <div className="warning-icon">⚠️</div>
          <h3>Email Not Confirmed</h3>
          <p>
            Your email address has not been confirmed yet. Please contact LootMart admin for assistance.
          </p>
          <p className="contact-info">
            Email: <a href="mailto:admin@lootmart.com">admin@lootmart.com</a>
          </p>
        </div>
      ) : (
        <NotificationSubscription
          merchant={merchant}
          onSubscribe={handleSubscribe}
        />
      )}
    </div>
  );
};

export default PopupApp;
