import { Navigate, createBrowserRouter } from 'react-router-dom';
import {
  IdentityFoundationPage,
  NotFoundPage,
} from './foundation-pages';
import { RequireAdmin, RequireUser } from './guards';
import { AdminSessionBoundary, SurveySessionBoundary } from './SessionBoundaries';
import { AdminLoginPage, SurveyLoginPage, SurveyRegisterPage } from '../features/auth/AuthPages';
import { ProfilePage } from '../features/profile/ProfilePage';
import { EmployeeSurveyPage } from '../features/employee-survey/EmployeeSurveyPage';
import { PositionSurveyPage } from '../features/position-survey/PositionSurveyPage';
import { MyResponsesPage } from '../features/responses/MyResponsesPage';
import { EmployeeReviewPage } from '../features/responses/EmployeeReviewPage';
import { PositionReviewPage } from '../features/responses/PositionReviewPage';
import {
  AdminOverviewPage,
  DemandWorkbenchPage,
  DifferencesPage,
  EmployeeResponseDetailPage,
  EmployeeResponsesPage,
  PositionResponseDetailPage,
  PositionResponsesPage,
} from '../features/admin';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate replace to="/survey/login" /> },
  { path: '/survey/login', element: <SurveyLoginPage /> },
  { path: '/survey/register', element: <SurveyRegisterPage /> },
  { path: '/admin/login', element: <AdminLoginPage /> },
  {
    element: <RequireUser />,
    children: [
      { element: <SurveySessionBoundary />, children: [
        { path: '/survey/identity', element: <IdentityFoundationPage /> },
        { path: '/survey/profile', element: <ProfilePage /> },
        { path: '/survey/employee', element: <EmployeeSurveyPage /> },
        { path: '/survey/position', element: <PositionSurveyPage /> },
        { path: '/survey/responses', element: <MyResponsesPage /> },
        { path: '/survey/responses/employee/:id', element: <EmployeeReviewPage /> },
        { path: '/survey/responses/position/:id', element: <PositionReviewPage /> },
      ] },
    ],
  },
  {
    element: <RequireAdmin />,
    children: [
      { element: <AdminSessionBoundary />, children: [
        { path: '/admin', element: <AdminOverviewPage /> },
        { path: '/admin/demands', element: <DemandWorkbenchPage /> },
        { path: '/admin/differences', element: <DifferencesPage /> },
        { path: '/admin/employee-responses', element: <EmployeeResponsesPage /> },
        { path: '/admin/employee-responses/:id', element: <EmployeeResponseDetailPage /> },
        { path: '/admin/position-responses', element: <PositionResponsesPage /> },
        { path: '/admin/position-responses/:id', element: <PositionResponseDetailPage /> },
      ] },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
