import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import axiosInstance, {
   TOKEN_STORAGE_KEY,
   USER_STORAGE_KEY,
} from './AxiosInstance';
import PublicNavBar from './PublicNavBar';
import Toast from './Toast';

const Login = () => {
   const navigate = useNavigate()
   const location = useLocation()
   // Set by ProtectedRoute when it interrupts a navigation, so signing in
   // returns the user to the page they originally asked for.
   const intendedPath = location.state?.from?.pathname || '/dashboard'
   const [viewMode, setViewMode] = useState('login'); // 'login', 'forgot', 'reset'
   const [data, setData] = useState({
      email: "",
      password: "",
   })
   const [forgotEmail, setForgotEmail] = useState('');
   const [resetToken, setResetToken] = useState('');
   const [newPassword, setNewPassword] = useState('');
   const [toast, setToast] = useState({ message: '', type: 'info' });

   const showToast = (message, type = 'info') => {
      setToast({ message, type });
   };

   const closeToast = () => {
      setToast({ message: '', type: 'info' });
   };

   // The axios response interceptor sends an expired session here with a
   // ?session=expired marker, so the user is told why they were signed out.
   useEffect(() => {
      const params = new URLSearchParams(window.location.search);

      if (params.get('session') === 'expired') {
         setToast({
            message: 'Your session expired. Please sign in again.',
            type: 'info',
         });
      }
   }, []);

   const handleChange = (e) => {
      const { name, value } = e.target;
      setData({ ...data, [name]: value });
   };

   const handleSubmit = (e) => {
      e.preventDefault();

      if (!data?.email || !data?.password) {
         return showToast("Please fill all fields", "error");
      } else {
         axiosInstance.post('/api/user/login', data)
            .then((res) => {
               if (res.data.success) {
                  showToast(res.data.message, "success");

                  localStorage.setItem(TOKEN_STORAGE_KEY, res.data.token);
                  localStorage.setItem(
                     USER_STORAGE_KEY,
                     JSON.stringify(res.data.userData),
                  );
                  navigate(intendedPath, { replace: true })
                  setTimeout(() => {
                     window.location.reload()
                  }, 1000)
               } else {
                  showToast(res.data.message, "error");
               }
            })
            .catch((err) => {
               if (err.response && err.response.status === 401) {
                  showToast("User doesn't exist", "error");
               }
               navigate("/login");
            });
      }
   };

   const handleForgotSubmit = (e) => {
      e.preventDefault();
      if (!forgotEmail) return showToast("Please enter email", "error");
      axiosInstance.post('/api/user/forgot-password', { email: forgotEmail })
         .then((res) => {
            showToast(res.data.message, "success");
            setViewMode('reset');
         })
         .catch((err) => {
            console.log(err);
            showToast("Error sending reset email", "error");
         });
   };

   const handleResetSubmit = (e) => {
      e.preventDefault();
      if (!forgotEmail || !resetToken || !newPassword) {
         return showToast("Please fill all fields", "error");
      }
      axiosInstance.post('/api/user/reset-password', {
         email: forgotEmail,
         token: resetToken,
         newPassword: newPassword
      })
         .then((res) => {
            if (res.data.success) {
               showToast(res.data.message, "success");
               setViewMode('login');
            } else {
               showToast(res.data.message || "Failed to reset password", "error");
            }
         })
         .catch((err) => {
            console.log(err);
            showToast("Reset failed. Please verify code and password requirements.", "error");
         });
   };

   return (
      <>
         <Toast message={toast.message} type={toast.type} onClose={closeToast} />

         <PublicNavBar />

         <div className='first-container premium-bg'>
            <Container component="main" className="premium-login-container">
               <Box className="premium-login-box">
                  <Avatar sx={{ bgcolor: 'secondary.main' }}>
                  </Avatar>
                  <Typography component="h1" variant="h5">
                     {viewMode === 'login' && "Sign In"}
                     {viewMode === 'forgot' && "Forgot Password"}
                     {viewMode === 'reset' && "Reset Password"}
                  </Typography>

                  {viewMode === 'login' && (
                     <Box component="form" onSubmit={handleSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="email"
                           label="Email Address"
                           name="email"
                           value={data.email}
                           onChange={handleChange}
                           autoComplete="email"
                           autoFocus
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           name="password"
                           value={data.password}
                           onChange={handleChange}
                           label="Password"
                           type="password"
                           id="password"
                           autoComplete="current-password"
                        />
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              Sign In
                           </Button>
                        </Box>
                        <Grid container justifyContent="space-between">
                           <Grid item>
                              <Link style={{ color: "blue" }} to={'/register'} variant="body2">
                                 {"Sign Up"}
                              </Link>
                           </Grid>
                           <Grid item>
                              <span style={{ color: "blue", cursor: "pointer" }} onClick={() => setViewMode('forgot')}>
                                 {"Forgot password?"}
                              </span>
                           </Grid>
                        </Grid>
                     </Box>
                  )}

                  {viewMode === 'forgot' && (
                     <Box component="form" onSubmit={handleForgotSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="forgotEmail"
                           label="Email Address"
                           value={forgotEmail}
                           onChange={(e) => setForgotEmail(e.target.value)}
                           autoComplete="email"
                           autoFocus
                        />
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              Send Reset Code
                           </Button>
                        </Box>
                        <span style={{ color: "blue", cursor: "pointer" }} onClick={() => setViewMode('login')}>
                           {"Back to Login"}
                        </span>
                     </Box>
                  )}

                  {viewMode === 'reset' && (
                     <Box component="form" onSubmit={handleResetSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="forgotEmail"
                           label="Email Address"
                           value={forgotEmail}
                           onChange={(e) => setForgotEmail(e.target.value)}
                           autoComplete="email"
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           id="resetToken"
                           label="Reset Code (OTP)"
                           value={resetToken}
                           onChange={(e) => setResetToken(e.target.value)}
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           id="newPassword"
                           label="New Password"
                           type="password"
                           value={newPassword}
                           onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              Update Password
                           </Button>
                        </Box>
                        <span style={{ color: "blue", cursor: "pointer" }} onClick={() => setViewMode('login')}>
                           {"Cancel"}
                        </span>
                     </Box>
                  )}
               </Box>
            </Container>
         </div>

      </>
   )
}

export default Login