import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import {
  Button,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  styled,
  tableCellClasses,
} from '@mui/material';

import CatalogPager from '../../common/CatalogPager';
import useEnrolledCourses from '../../../hooks/useEnrolledCourses';
import {
  PROGRESS_STATES,
  courseHref,
  describeEnrolledRange,
  describeProgress,
  formatEnrolledDate,
  progressState,
  readProgress,
} from '../../../lib/enrolledCourses';

// #65 made GET /api/user/getallcoursesuser paginated and gave every row a
// progress summary. This table called it bare and read two fields off each
// row, so enrolment thirteen was unreachable and the progress the server had
// already computed was never shown. The Course ID column, meanwhile, was the
// widest thing on screen and of no use to a learner.

const StyledTableCell = styled(TableCell)(({ theme }) => ({
   [`&.${tableCellClasses.head}`]: {
      backgroundColor: theme.palette.common.black,
      color: theme.palette.common.white,
   },
   [`&.${tableCellClasses.body}`]: {
      fontSize: 14,
   },
}));

const StyledTableRow = styled(TableRow)(({ theme }) => ({
   '&:nth-of-type(odd)': {
      backgroundColor: theme.palette.action.hover,
   },
   // hide last border
   '&:last-child td, &:last-child th': {
      border: 0,
   },
}));

const PROGRESS_COLOR = {
   [PROGRESS_STATES.COMPLETE]: 'success',
   [PROGRESS_STATES.IN_PROGRESS]: 'primary',
   [PROGRESS_STATES.NOT_STARTED]: 'inherit',
};

const ProgressCell = ({ row }) => {
   const progress = readProgress(row);
   const state = progressState(progress);

   return (
      <div className="enrolled-progress">
         <LinearProgress
            variant="determinate"
            value={progress.percent}
            color={PROGRESS_COLOR[state]}
            aria-label={`${progress.percent}% complete`}
            sx={{ height: 8, borderRadius: 4, marginBottom: '6px' }}
         />
         <small>
            {describeProgress(progress)}
            {progress.total > 0 ? ` · ${progress.percent}%` : ''}
         </small>
      </div>
   );
};

ProgressCell.propTypes = {
   row: PropTypes.shape({
      progress: PropTypes.shape({
         completed: PropTypes.number,
         total: PropTypes.number,
         percent: PropTypes.number,
      }),
      courseLength: PropTypes.number,
   }).isRequired,
};

const EnrolledCourses = () => {
   const { courses, pagination, loading, error, goToPage, reload } =
      useEnrolledCourses();

   if (loading && courses.length === 0) {
      return (
         <div className="course-state" role="status">
            <span className="catalog-loader" aria-hidden="true" />
            <h3>Loading your courses…</h3>
         </div>
      );
   }

   // A failed request used to be a console.log and a permanently empty table.
   if (error) {
      return (
         <div className="course-state course-state-error" role="alert">
            <h3>Your courses could not be loaded</h3>
            <p>{error}</p>
            <button type="button" className="button button-ink" onClick={reload}>
               Try again
            </button>
         </div>
      );
   }

   if (courses.length === 0) {
      return (
         <div className="course-state">
            <h3>You have not enrolled in a course yet</h3>
            <p>Browse the catalogue and enrol to see your progress here.</p>
         </div>
      );
   }

   return (
      <>
         <TableContainer component={Paper}>
            <Table sx={{ minWidth: 700 }} aria-label="Enrolled courses">
               <TableHead>
                  <TableRow>
                     <StyledTableCell>Course</StyledTableCell>
                     <StyledTableCell align="left">Educator</StyledTableCell>
                     <StyledTableCell align="left">Category</StyledTableCell>
                     <StyledTableCell align="left">Progress</StyledTableCell>
                     <StyledTableCell align="left">Enrolled</StyledTableCell>
                     <StyledTableCell align="left">Action</StyledTableCell>
                  </TableRow>
               </TableHead>
               <TableBody>
                  {courses.map((course) => (
                     <StyledTableRow key={course._id}>
                        <StyledTableCell component="th" scope="row">
                           {course.C_title}
                        </StyledTableCell>
                        <StyledTableCell>{course.C_educator}</StyledTableCell>
                        <StyledTableCell>{course.C_categories}</StyledTableCell>
                        <StyledTableCell>
                           <ProgressCell row={course} />
                        </StyledTableCell>
                        <StyledTableCell>
                           {formatEnrolledDate(course.enrolledAt) || '—'}
                        </StyledTableCell>
                        <StyledTableCell>
                           {/* The title used to be interpolated into the path
                               unencoded, so a course called "HTTP/2 in
                               practice" produced a URL with an extra segment
                               and the route matched something else. */}
                           <Link to={courseHref(course)}>
                              <Button size="small" variant="contained" color="success">
                                 Go To
                              </Button>
                           </Link>
                        </StyledTableCell>
                     </StyledTableRow>
                  ))}
               </TableBody>
            </Table>
         </TableContainer>

         <p className="catalog-range" aria-live="polite">
            {describeEnrolledRange(pagination, courses.length)}
         </p>

         <CatalogPager
            pagination={pagination}
            onPageChange={goToPage}
            disabled={loading}
            label="Enrolled course pages"
         />
      </>
   );
};

export default EnrolledCourses;
