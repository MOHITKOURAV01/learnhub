import React, { useContext, useState } from 'react';
import NavBar from './NavBar';
import UserHome from "./UserHome"
import { Container } from 'react-bootstrap';
import AddCourse from '../user/teacher/AddCourse';
import { UserContext } from '../../App';
import EnrolledCourses from '../user/student/EnrolledCourses';
import CourseContent from '../user/student/CourseContent';
import AllCourses from '../admin/AllCourses';
import { ROLES, hasAnyRole, isRole } from '../../lib/roles';

// The role guards below compared against 'Teacher' and 'Admin' while the API
// stores the role lowercase, so both fell through to <UserHome /> — which was
// itself blank for the same reason. Comparisons go through lib/roles now.

const Dashboard = () => {
   const user = useContext(UserContext)
   const [selectedComponent, setSelectedComponent] = useState('home');

   const renderSelectedComponent = () => {
      const userData = user?.userData;

      switch (selectedComponent) {
         case 'home':
            return <UserHome />
         case 'addcourse':
            if (hasAnyRole(userData, [ROLES.TEACHER, ROLES.ADMIN])) {
               return <AddCourse />
            }
            return <UserHome />
         case 'enrolledcourese':
            return <EnrolledCourses />
         case 'cousreSection':
            return <CourseContent />
         case 'cousres':
            if (isRole(userData, ROLES.ADMIN)) {
               return <AllCourses />
            }
            return <UserHome />
         default:
            return <UserHome />
      }
   };

   return (
      <>
         <NavBar setSelectedComponent={setSelectedComponent} />
         <Container className='my-3 dashboard-glass' style={{maxWidth:'1100px', borderRadius:'22px', boxShadow:'0 8px 32px 0 #00e0ff22', background:'rgba(30,41,59,0.82)', padding:'32px 24px'}}>
            {renderSelectedComponent()}
         </Container>
      </>
   );
};

export default Dashboard;
