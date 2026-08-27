import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import axiosInstance from './AxiosInstance';
import PublicNavBar from './PublicNavBar';
import Dropdown from 'react-bootstrap/Dropdown';
import Toast from './Toast';
import VerifyEmailPanel, {
   readPendingVerification,
   writePendingVerification,
} from './VerifyEmailPanel';
import { ROLES, roleLabel } from '../../lib/roles';




const Register = () => {
   const navigate = useNavigate()
   const [selectedOption, setSelectedOption] = useState('Select User');
   // The address awaiting verification. Empty means "show the sign-up form".
   // Seeded from sessionStorage so a refresh on the verify step does not strand
   // the account: the code is in the user's inbox but the old component state
   // was the only thing that knew which address to send it for.
   const [pendingEmail, setPendingEmail] = useState(() => readPendingVerification());
   const [submitting, setSubmitting] = useState(false);
   const [toast, setToast] = useState({ message: '', type: 'info' });
   const [data, setData] = useState({
      name: "",
      email: "",
      password: "",
      type: "",
   })

   const notify = (message, type = 'info') => setToast({ message, type });
   const closeToast = () => setToast({ message: '', type: 'info' });

   useEffect(() => {
      writePendingVerification(pendingEmail);
   }, [pendingEmail]);

   // The stored value and the label on the toggle are not the same thing: the
   // API lowercases `type` on write, so posting "Student" only meant the
   // capitalisation survived as far as the schema and then vanished.
   const handleSelect = (role) => {
      setSelectedOption(roleLabel(role));
      setData({ ...data, type: role });
   };

   const handleChange = (e) => {
      const { name, value } = e.target;
      setData({ ...data, [name]: value });
   };

   const handleSubmit = async (e) => {
      e.preventDefault()

      if (!data?.name || !data?.email || !data?.password || !data?.type) {
         return notify('Please fill all fields', 'error');
      }

      if (data.password.length < 6) {
         return notify('Password must be at least 6 characters.', 'error');
      }

      setSubmitting(true);

      try {
         const response = await axiosInstance.post('/api/user/register', data);

         if (response.data.success) {
            notify(response.data.message, 'success');
            // Also covers the re-registration case: an address with an
            // unverified registration gets a fresh code instead of the old
            // "User already exists" dead end.
            setPendingEmail(data.email.trim().toLowerCase());
            return;
         }

         notify(
            response.data.message || 'Registration failed. Please try again.',
            'error',
         );
      } catch (error) {
         const retryAfter = error.response?.data?.retryAfterSeconds;

         if (error.response?.data?.needsVerification) {
            // A code went out moments ago; go straight to the verify step
            // rather than making the user register a third time.
            setPendingEmail(data.email.trim().toLowerCase());
            notify(error.response.data.message, 'info');
            return;
         }

         notify(
            error.response?.data?.message ||
               (retryAfter
                  ? `Please wait ${retryAfter}s and try again.`
                  : 'Registration failed. Please try again.'),
            'error',
         );
      } finally {
         setSubmitting(false);
      }
   };


   return (
      <>
         <Toast message={toast.message} type={toast.type} onClose={closeToast} />

         <PublicNavBar />
         <div className="first-container premium-bg">
            <Container component="main" className="premium-login-container">
               <Box className="premium-login-box">
                  <Avatar sx={{ bgcolor: 'secondary.main' }}>
                     {/* <LockOutlinedIcon /> */}
                  </Avatar>
                  <Typography component="h1" variant="h5">
                     {pendingEmail ? "Verify Email" : "Register"}
                  </Typography>
                  {pendingEmail ? (
                     <VerifyEmailPanel
                        email={pendingEmail}
                        notify={notify}
                        onVerified={() => {
                           setPendingEmail('');
                           navigate('/login');
                        }}
                        onCancel={() => setPendingEmail('')}
                     />
                  ) : (
                     <Box component="form" onSubmit={handleSubmit} noValidate>
                        <TextField
                           margin="normal"
                           fullWidth
                           id="name"
                           label="Full Name"
                           name="name"
                           value={data.name}
                           onChange={handleChange}
                           autoComplete="name"
                           autoFocus
                        />
                        <TextField
                           margin="normal"
                           fullWidth
                           id="email"
                           label="Email Address"
                           name="email"
                           value={data.email}
                           onChange={handleChange}
                           autoComplete="email"
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
                           autoComplete="new-password"
                        />
                        <Dropdown className='my-3'>
                           <Dropdown.Toggle variant="outline-secondary" id="dropdown-basic">
                              {selectedOption}
                           </Dropdown.Toggle>

                           <Dropdown.Menu>
                              {/* The API lowercases `type` on write, so post
                                  the value it actually stores rather than a
                                  spelling that only survives as far as the
                                  schema. */}
                              <Dropdown.Item onClick={() => handleSelect(ROLES.STUDENT)}>Student</Dropdown.Item>
                              <Dropdown.Item onClick={() => handleSelect(ROLES.TEACHER)}>Teacher</Dropdown.Item>
                           </Dropdown.Menu>
                        </Dropdown>
                        <Box mt={2}>
                           <Button
                              type="submit"
                              variant="contained"
                              disabled={submitting}
                              sx={{ mt: 3, mb: 2 }}
                              style={{ width: '200px' }}
                           >
                              {submitting ? 'Signing up…' : 'Sign Up'}
                           </Button>
                        </Box>
                        <Grid container>
                           <Grid item>Have an account?
                              <Link style={{ color: "blue" }} to={'/login'} variant="body2">
                                 {" Sign In"}
                              </Link>
                           </Grid>
                        </Grid>
                     </Box>
                  )}
               </Box>
            </Container>
         </div>

      </>
   )
}

export default Register
