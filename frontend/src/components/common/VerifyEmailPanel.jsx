import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import axiosInstance from './AxiosInstance';

// The verify step is reached from two places — straight after registering, and
// after a sign-in attempt on an account that was never verified — so it lives
// in one component rather than being written twice.

export const PENDING_VERIFICATION_KEY = 'pendingVerificationEmail';

// The step used to be held in Register's useState alone. A refresh, a closed
// tab, or reading the code in another tab and coming back threw away both the
// step and the address, and there was no way back to it. sessionStorage keeps
// it for the life of the tab; it holds an address the user just typed, nothing
// secret.
export const readPendingVerification = () => {
   try {
      return window.sessionStorage.getItem(PENDING_VERIFICATION_KEY) || '';
   } catch {
      return '';
   }
};

export const writePendingVerification = (email) => {
   try {
      if (email) {
         window.sessionStorage.setItem(PENDING_VERIFICATION_KEY, email);
      } else {
         window.sessionStorage.removeItem(PENDING_VERIFICATION_KEY);
      }
   } catch {
      // Private browsing can refuse storage. The in-memory flow still works,
      // it just will not survive a refresh.
   }
};

const RESEND_COOLDOWN_SECONDS = 60;

const VerifyEmailPanel = ({ email, onVerified, onCancel, notify }) => {
   const [otp, setOtp] = useState('');
   const [submitting, setSubmitting] = useState(false);
   const [resending, setResending] = useState(false);
   const [cooldown, setCooldown] = useState(0);
   const intervalRef = useRef(null);

   const startCooldown = useCallback((seconds) => {
      setCooldown(Math.max(0, Math.ceil(seconds)));
   }, []);

   useEffect(() => {
      if (cooldown <= 0) return undefined;

      intervalRef.current = setInterval(() => {
         setCooldown((current) => (current <= 1 ? 0 : current - 1));
      }, 1000);

      return () => clearInterval(intervalRef.current);
   }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

   const handleVerify = async (event) => {
      event.preventDefault();

      const code = otp.trim();

      if (!/^\d{6}$/.test(code)) {
         notify('Enter the 6-digit code from your email.', 'error');
         return;
      }

      setSubmitting(true);

      try {
         const res = await axiosInstance.post('/api/user/verify-otp', {
            email,
            otp: code,
         });

         if (res.data.success) {
            writePendingVerification('');
            notify(res.data.message, 'success');
            onVerified();
            return;
         }

         notify(res.data.message || 'Verification failed.', 'error');

         // The server says whether asking for another code would actually do
         // something, so the button is not offered when it would only 429.
         if (res.data.canResend === false) {
            startCooldown(RESEND_COOLDOWN_SECONDS);
         }
      } catch (error) {
         notify(
            error.response?.data?.message ||
               'Verification failed. Please try again.',
            'error',
         );
      } finally {
         setSubmitting(false);
      }
   };

   const handleResend = async () => {
      setResending(true);

      try {
         const res = await axiosInstance.post('/api/user/resend-otp', { email });

         notify(res.data.message, 'success');
         startCooldown(RESEND_COOLDOWN_SECONDS);
      } catch (error) {
         const retryAfter = error.response?.data?.retryAfterSeconds;

         if (retryAfter) {
            startCooldown(retryAfter);
            notify(error.response.data.message, 'info');
         } else {
            notify('Could not send a new code. Please try again.', 'error');
         }
      } finally {
         setResending(false);
      }
   };

   return (
      <Box component="form" onSubmit={handleVerify} noValidate>
         <Typography variant="body2" sx={{ my: 2 }}>
            Enter the 6-digit code sent to <strong>{email}</strong>. It is valid
            for 10 minutes.
         </Typography>

         <TextField
            margin="normal"
            fullWidth
            id="otp"
            name="otp"
            label="6-digit code"
            value={otp}
            onChange={(event) =>
               setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            inputProps={{ inputMode: 'numeric', maxLength: 6 }}
            autoComplete="one-time-code"
            autoFocus
         />

         <Box mt={2}>
            <Button
               type="submit"
               variant="contained"
               disabled={submitting}
               sx={{ mt: 3, mb: 2 }}
               style={{ width: '200px' }}
            >
               {submitting ? 'Verifying…' : 'Verify email'}
            </Button>
         </Box>

         <Box
            sx={{
               display: 'flex',
               justifyContent: 'space-between',
               alignItems: 'center',
               gap: 2,
            }}
         >
            <Button
               type="button"
               size="small"
               onClick={handleResend}
               disabled={resending || cooldown > 0}
            >
               {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code'}
            </Button>

            <span
               style={{ color: 'blue', cursor: 'pointer' }}
               onClick={() => {
                  writePendingVerification('');
                  onCancel();
               }}
            >
               Use a different email
            </span>
         </Box>
      </Box>
   );
};

export default VerifyEmailPanel;
