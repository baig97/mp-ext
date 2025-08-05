import React, { useState } from 'react';
import { type Merchant } from '../_shared/supabase-config';

interface NotificationSubscriptionProps {
  merchant: Merchant | null;
  onSubscribe: () => Promise<void>;
}

const NotificationSubscription: React.FC<NotificationSubscriptionProps> = ({
  merchant,
  onSubscribe,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');

    try {
      await onSubscribe();
    } catch (error: any) {
      setError(error.message || 'Subscription failed');
    } finally {
      setLoading(false);
    }
  };

  const isSubscribed = merchant?.subscribed_to_notifications && merchant?.fcm_token;

  return (
    <div className="notification-subscription">
      <h3>Push Notifications</h3>
      <p className="description">
        Get notified about important updates to your inventory and orders.
      </p>

      {isSubscribed ? (
        <div className="subscribed-status">
          <div className="status-indicator">
            <span className="status-icon">✓</span>
            <span className="status-text">Subscribed</span>
          </div>
          <p className="status-description">
            You're all set! You'll receive push notifications for important updates.
          </p>
        </div>
      ) : (
        <div className="subscription-form">
          {error && <div className="error">{error}</div>}
          
          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="subscribe-btn"
          >
            {loading ? 'Subscribing...' : 'Subscribe to Notifications'}
          </button>
          
          <p className="permission-note">
            You'll be asked to allow notifications from this extension.
          </p>
        </div>
      )}
    </div>
  );
};

export default NotificationSubscription;
