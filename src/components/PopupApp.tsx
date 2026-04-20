import React, { useState, useEffect } from 'react';
import { supabase, type Merchant } from '../_shared/supabase-config';
import LoginForm from './LoginForm';
import ConnectionStatus from './ConnectionStatus';

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
        
        if (user) {
          setUser(user);
          await fetchMerchantData(user.email!);
        }
      } catch (error) {
        console.error('Error during auth check:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event, session?.user?.email);
        
        if (event === 'SIGNED_IN' && session?.user) {
          setUser(session.user);
          // Fetch merchant data and sync with background
          setTimeout(async () => {
            await fetchMerchantData(session.user.email!);
            await syncAuthWithBackground();
          }, 0);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setMerchant(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const syncAuthWithBackground = async () => {
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
  };

  const updateFCMToken = async () => {
    try {
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage({ action: 'updateFCMToken' }, (response) => {
          if (response?.success) {
            console.log('✅ FCM token updated successfully');
          } else {
            console.error('❌ Failed to update FCM token:', response?.error);
          }
          resolve();
        });
      });
    } catch (error) {
      console.error('❌ Error updating FCM token:', error);
    }
  };

  const fetchMerchantData = async (email: string) => {
    try {
      console.log('Fetching merchant data for:', email);
      
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser?.id) {
        console.error('No user.id available');
        return;
      }

      const { data, error } = await supabase
        .from('merchants')
        .select(`
          *,
          store:stores(name)
        `)
        .eq('id', currentUser.id)
        .single();

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

      console.log('Merchant data received:', data);
      setMerchant(data);

      // Update background script merchant data
      try {
        await new Promise<void>((resolve) => {
          chrome.runtime.sendMessage({ action: 'refreshMerchantData' }, (response) => {
            if (response?.success) {
              console.log('✅ Background script merchant data refreshed');
            } else {
              console.error('❌ Failed to refresh background merchant data:', response?.error);
            }
            resolve();
          });
        });
      } catch (error) {
        console.error('❌ Error refreshing background merchant data:', error);
      }
    } catch (error: any) {
      console.error('Error fetching merchant data:', error);
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
        <h2>LootMart Extension</h2>
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
        <>
          <ConnectionStatus />
          <div className="fcm-section">
            <button onClick={updateFCMToken} className="fcm-btn">
              Update FCM Token
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default PopupApp;
