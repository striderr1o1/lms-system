export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: "student" | "teacher" | "admin";
  teacher_status: "pending" | "approved" | "rejected" | null;
  is_active: boolean;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface Course {
  id: string;
  teacher_id: string;
  teacher_name: string | null;
  title: string;
  description: string | null;
  category: string | null;
  thumbnail_url: string | null;
  status: "draft" | "published" | "archived";
  created_at: string;
  updated_at: string;
  enrollment_count?: number;
}

export interface ProgressBrief {
  is_completed: boolean;
  last_position_sec: number;
}

export interface LessonContent {
  id: string;
  title: string;
  type: "video" | "text" | "link" | "file";
  position: number;
  body_markdown: string | null;
  external_url: string | null;
  file_url: string | null;
  duration_sec: number | null;
  progress: ProgressBrief | null;
}

export interface SectionContent {
  id: string;
  title: string;
  position: number;
  lessons: LessonContent[];
}

export interface CourseContent {
  course_id: string;
  title: string;
  status: string;
  sections: SectionContent[];
}

export interface Enrollment {
  id: string;
  student_id: string;
  course_id: string;
  enrolled_at: string;
  completed_at: string | null;
  course_title: string;
  course_category: string | null;
  course_status: string;
  thumbnail_url: string | null;
  completed_lesson_count: number;
  lesson_count: number;
  resume_lesson_id: string | null;
}

export interface SectionRecord {
  id: string;
  course_id: string;
  title: string;
  position: number;
}

export interface LessonRecord {
  id: string;
  section_id: string;
  title: string;
  type: LessonContent["type"];
  position: number;
  body_markdown: string | null;
  external_url: string | null;
  file_url: string | null;
  duration_sec: number | null;
}

export interface CourseStudent {
  student_id: string;
  name: string | null;
  email: string | null;
  enrolled_at: string;
  completed_at: string | null;
  completed_lesson_count: number;
}

export interface DayCount {
  day: string;
  count: number;
}

export interface OverviewAnalytics {
  totals_by_role: { student: number; teacher: number; admin: number };
  signups_by_day: DayCount[];
  courses_by_status: { draft: number; published: number; archived: number };
  enrollments_by_day: DayCount[];
  active_learners_by_day: DayCount[];
  window_days: number;
}

export interface TopCourse {
  course_id: string;
  title: string;
  status: string;
  teacher_id: string;
  enrollment_count: number;
  completion_rate: number;
}

export interface TeacherLeaderboardRow {
  teacher_id: string;
  full_name: string | null;
  email: string | null;
  course_count: number;
  student_count: number;
  completion_rate: number;
}

export interface CourseAnalytics {
  top_courses: TopCourse[];
  teacher_leaderboard: TeacherLeaderboardRow[];
}

export interface EngagementLesson {
  lesson_id: string;
  title: string;
  section_title: string;
  section_position: number;
  lesson_position: number;
  completed_count: number;
}

export interface EngagementCourse {
  course_id: string;
  title: string;
  lessons: EngagementLesson[];
}

export interface EngagementAnalytics {
  courses: EngagementCourse[];
}
