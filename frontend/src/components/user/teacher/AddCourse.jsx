import React, { useState, useContext } from 'react';
import { Button, Form, Col, Row } from 'react-bootstrap';
import { UserContext } from '../../../App';
import axiosInstance from '../../common/AxiosInstance';

const AddCourse = () => {
   const user = useContext(UserContext);
   const [submitting, setSubmitting] = useState(false);
   const [formError, setFormError] = useState('');

   // The server takes the owner and the educator name from the bearer token, so
   // neither is posted any more. It used to read `userId` straight out of this
   // form, which meant the browser decided who owned the course.
   const [addCourse, setAddCourse] = useState({
      C_title: '',
      C_categories: '',
      C_price: '',
      C_description: '',
      sections: [],
   });

   const educatorName = user?.userData?.name || '';

   const handleChange = (e) => {
      const { name, value } = e.target;
      setAddCourse({ ...addCourse, [name]: value });
   };

   const handleCourseTypeChange = (e) => {
      setAddCourse({ ...addCourse, C_categories: e.target.value });
   };

   const addInputGroup = () => {
      setAddCourse({
         ...addCourse,
         sections: [
            ...addCourse.sections,
            {
               S_title: '',
               S_description: '',
               S_content: null,
            },
         ],
      });
   };

   const handleChangeSection = (index, e) => {
      const updatedSections = [...addCourse.sections];
      const sectionToUpdate = updatedSections[index];

      if (e.target.name.endsWith('S_content')) {
         sectionToUpdate.S_content = e.target.files[0];
      } else {
         sectionToUpdate[e.target.name] = e.target.value;
      }

      setAddCourse({ ...addCourse, sections: updatedSections });
   };

   const removeInputGroup = (index) => {
      const updatedSections = [...addCourse.sections];
      updatedSections.splice(index, 1);
      setAddCourse({
         ...addCourse,
         sections: updatedSections,
      });
   };

   const handleSubmit = async (e) => {
      e.preventDefault();

      // The server pairs each uploaded file with the S_title and S_description
      // at the same position. Appending the text of a section that carries no
      // file shifted every later section onto the wrong video.
      const sectionsWithVideo = addCourse.sections.filter(
         (section) => section.S_content instanceof File,
      );

      if (sectionsWithVideo.length === 0) {
         setFormError('Add at least one section with an .mp4 video.');
         return;
      }

      if (sectionsWithVideo.length !== addCourse.sections.length) {
         setFormError('Every section needs a video before the course can be created.');
         return;
      }

      setFormError('');

      const formData = new FormData();

      Object.keys(addCourse).forEach((key) => {
         if (key !== 'sections') {
            formData.append(key, addCourse[key]);
         }
      });

      sectionsWithVideo.forEach((section) => {
         formData.append('S_content', section.S_content);
         formData.append('S_title', section.S_title);
         formData.append('S_description', section.S_description);
      });

      setSubmitting(true);

      try {
         const res = await axiosInstance.post('/api/user/addcourse', formData, {
            headers: {
               'Content-Type': 'multipart/form-data',
            },
         });

         if (res.data.success) {
            alert(res.data.message);
            setAddCourse({
               C_title: '',
               C_categories: '',
               C_price: '',
               C_description: '',
               sections: [],
            });
         } else {
            setFormError(res.data.message || 'Failed to create course.');
         }
      } catch (error) {
         // The API answers 400 with a readable reason now, so show it instead
         // of guessing that the upload must have been the wrong file type.
         setFormError(
            error.response?.data?.message ||
               'The course could not be created. Only .mp4 videos can be uploaded.',
         );
      } finally {
         setSubmitting(false);
      }
   };

   return (
      <div className=''>
         <Form className="mb-3" onSubmit={handleSubmit}>
            <Row className="mb-3">
               <Form.Group as={Col} controlId="formGridJobType">
                  <Form.Label>Course Type</Form.Label>
                  <Form.Select value={addCourse.C_categories} onChange={handleCourseTypeChange}>
                     <option>Select categories</option>
                     <option>IT & Software</option>
                     <option>Finance & Accounting</option>
                     <option>Personal Development</option>
                  </Form.Select>
               </Form.Group>
               <Form.Group as={Col} controlId="formGridTitle">
                  <Form.Label>Course Title</Form.Label>
                  <Form.Control name='C_title' value={addCourse.C_title} onChange={handleChange} type="text" placeholder="Enter Course Title" required />
               </Form.Group>
            </Row>

            <Row className="mb-3">
               <Form.Group as={Col} controlId="formGridEducator">
                  <Form.Label>Course Educator</Form.Label>
                  {/* Read-only: the server credits the signed-in account. The
                      editable version let a course be published under anyone's
                      name. */}
                  <Form.Control
                     value={educatorName}
                     type="text"
                     readOnly
                     disabled
                     aria-describedby="educatorHelp"
                  />
                  <Form.Text id="educatorHelp" muted>
                     Courses are published under your account name.
                  </Form.Text>
               </Form.Group>
               <Form.Group as={Col} controlId="formGridTitle">
                  <Form.Label>Course Price(Rs.)</Form.Label>
                  <Form.Control name='C_price' value={addCourse.C_price} onChange={handleChange} type="text" placeholder="for free course, enter 0" required />
               </Form.Group>
               <Form.Group as={Col} className="mb-3" controlId="formGridAddress2">
                  <Form.Label>Course Description</Form.Label>
                  <Form.Control name='C_description' value={addCourse.C_description} onChange={handleChange} required as={"textarea"} placeholder="Enter Course description" />
               </Form.Group>
            </Row>

            <hr />

            {addCourse.sections.map((section, index) => (
               <div key={index} className="d-flex flex-column mb-4 border rounded-3 border-3 p-3 position-relative">
                  <Col xs={24} md={12} lg={8}>
                     <span style={{ cursor: 'pointer' }} className="position-absolute top-0 end-0 p-1" onClick={() => removeInputGroup(index)}>
                        ❌
                     </span>
                  </Col>
                  <Row className='mb-3'>
                     <Form.Group as={Col} controlId="formGridTitle">
                        <Form.Label>Section Title</Form.Label>
                        <Form.Control
                           name={`S_title`}
                           value={section.S_title}
                           onChange={(e) => handleChangeSection(index, e)}
                           type="text"
                           placeholder="Enter Section Title"
                           required
                        />
                     </Form.Group>
                     <Form.Group as={Col} controlId="formGridContent">
                        <Form.Label>Section Content (Video or Image)</Form.Label>
                        <Form.Control
                           name={`S_content`}
                           onChange={(e) => handleChangeSection(index, e)}
                           type="file"
                           accept="video/*,image/*"
                           required
                        />
                     </Form.Group>

                     <Form.Group className="mb-3" controlId="formGridAddress2">
                        <Form.Label>Section Description</Form.Label>
                        <Form.Control
                           name={`S_description`}
                           value={section.S_description}
                           onChange={(e) => handleChangeSection(index, e)}
                           required
                           as={"textarea"}
                           placeholder="Enter Section description"
                        />
                     </Form.Group>
                  </Row>
               </div>
            ))}

            <Row className="mb-3">
               <Col xs={24} md={12} lg={8}>
                  <Button size='sm' variant='outline-secondary' onClick={addInputGroup}>
                     ➕Add Section
                  </Button>
               </Col>
            </Row>

            {formError ? (
               <div className="alert alert-danger py-2" role="alert">
                  {formError}
               </div>
            ) : null}

            <Button variant="primary" type="submit" disabled={submitting}>
               {submitting ? 'Creating…' : 'Submit'}
            </Button>
         </Form>
      </div>
   );
};

export default AddCourse;
