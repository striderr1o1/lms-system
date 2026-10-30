import { createBrowserRouter } from "react-router";
import { Layout } from "../components/Layout";
import { AdminAnalyticsPage } from "../pages/AdminAnalyticsPage";
import { AdminCoursesPage } from "../pages/AdminCoursesPage";
import { AdminHomePage } from "../pages/AdminHomePage";
import { AdminUsersPage } from "../pages/AdminUsersPage";
import { BuilderPage } from "../pages/BuilderPage";
import { CatalogPage } from "../pages/CatalogPage";
import { CourseDetailPage } from "../pages/CourseDetailPage";
import { HomePage } from "../pages/HomePage";
import { LearnPage } from "../pages/LearnPage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlayerPage } from "../pages/PlayerPage";
import { RegisterPage } from "../pages/RegisterPage";
import { StudentsPage } from "../pages/StudentsPage";
import { TeachPage } from "../pages/TeachPage";
import { RequireAuth, RequireRole } from "./guards";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/courses", element: <CatalogPage /> },
      { path: "/courses/:id", element: <CourseDetailPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/learn", element: <LearnPage /> },
          { path: "/learn/:courseId/:lessonId", element: <PlayerPage /> },
          {
            element: <RequireRole role="teacher" />,
            children: [
              { path: "/teach", element: <TeachPage /> },
              { path: "/teach/courses/:id", element: <BuilderPage /> },
              { path: "/teach/courses/:id/students", element: <StudentsPage /> },
            ],
          },
          {
            element: <RequireRole role="admin" />,
            children: [
              { path: "/admin", element: <AdminHomePage /> },
              { path: "/admin/users", element: <AdminUsersPage /> },
              { path: "/admin/courses", element: <AdminCoursesPage /> },
              { path: "/admin/analytics", element: <AdminAnalyticsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
