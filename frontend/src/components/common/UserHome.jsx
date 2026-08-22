import React, { useContext } from 'react';
import { Container } from 'react-bootstrap';
import { UserContext } from '../../App';
import TeacherHome from '../user/teacher/TeacherHome';
import AdminHome from '../admin/AdminHome';
import StudentHome from '../user/student/StudentHome';
import { ROLES, getUserRole } from '../../lib/roles';

// This component used to switch on `user.userData.type` against "Teacher",
// "Admin" and "Student". The API stores the role lowercase — `userModel`
// declares `type` with `lowercase: true` — so no case ever matched, `content`
// stayed undefined, and /dashboard rendered an empty panel for every account.
// Nothing threw, so it read as a page that never finished loading.

const UserHome = () => {
   const user = useContext(UserContext);
   const role = getUserRole(user?.userData);

   const renderForRole = () => {
      switch (role) {
         case ROLES.TEACHER:
            return <TeacherHome />;
         case ROLES.ADMIN:
            return <AdminHome />;
         case ROLES.STUDENT:
            return <StudentHome />;
         default:
            // Previously this branch rendered nothing at all, which is exactly
            // what made the mismatch so hard to see. Say so instead.
            return (
               <div className="course-state" role="status">
                  <h3>This account has no dashboard yet</h3>
                  <p>
                     We could not tell whether you are a student, an educator or
                     an admin. Signing out and back in usually fixes it.
                  </p>
               </div>
            );
      }
   };

   return <Container>{renderForRole()}</Container>;
};

export default UserHome;
