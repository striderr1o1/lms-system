import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorMessage } from "../api/client";
import type { CourseAnalytics, DayCount, EngagementAnalytics, OverviewAnalytics } from "../api/types";
import { Empty, ErrorNote, Loading, PageHeader } from "../components/ui";

export function AdminAnalyticsPage() {
  const overview = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api<OverviewAnalytics>("/api/v1/admin/analytics/overview"),
  });
  const courses = useQuery({
    queryKey: ["analytics", "courses"],
    queryFn: () => api<CourseAnalytics>("/api/v1/admin/analytics/courses"),
  });
  const engagement = useQuery({
    queryKey: ["analytics", "engagement"],
    queryFn: () => api<EngagementAnalytics>("/api/v1/admin/analytics/engagement"),
  });

  return (
    <div className="space-y-8">
      <PageHeader title="Analytics" lede="Counts come from profiles, courses, enrollments, and lesson progress. Daily charts use the last 30 days." />
      {overview.isLoading || courses.isLoading || engagement.isLoading ? <Loading label="Loading analytics" /> : null}
      {overview.isError ? <ErrorNote message={errorMessage(overview.error)} /> : null}
      {courses.isError ? <ErrorNote message={errorMessage(courses.error)} /> : null}
      {engagement.isError ? <ErrorNote message={errorMessage(engagement.error)} /> : null}
      {overview.data ? (
        <div className="space-y-6">
          <Chart title="Signups by day" data={overview.data.signups_by_day} />
          <Chart title="Enrollments by day" data={overview.data.enrollments_by_day} />
          <Chart title="Active learners by day" data={overview.data.active_learners_by_day} />
          <Chart
            title="Courses by status"
            data={Object.entries(overview.data.courses_by_status).map(([day, count]) => ({ day, count }))}
          />
        </div>
      ) : null}
      {courses.data ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Top courses</h2>
          {courses.data.top_courses.length === 0 ? <Empty>No courses yet.</Empty> : null}
          <Chart
            title="Enrollments"
            data={courses.data.top_courses.map((course) => ({ day: course.title, count: course.enrollment_count }))}
          />
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Enrollments</th>
                  <th className="px-3 py-2 font-medium">Completion</th>
                </tr>
              </thead>
              <tbody>
                {courses.data.top_courses.map((course) => (
                  <tr key={course.course_id} className="border-b border-zinc-100">
                    <td className="px-3 py-2">{course.title}</td>
                    <td className="px-3 py-2">{course.enrollment_count}</td>
                    <td className="px-3 py-2">{Math.round(course.completion_rate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 className="text-lg font-semibold">Teacher leaderboard</h2>
          {courses.data.teacher_leaderboard.length === 0 ? <Empty>No teachers with courses.</Empty> : null}
          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Teacher</th>
                  <th className="px-3 py-2 font-medium">Courses</th>
                  <th className="px-3 py-2 font-medium">Students</th>
                  <th className="px-3 py-2 font-medium">Completion</th>
                </tr>
              </thead>
              <tbody>
                {courses.data.teacher_leaderboard.map((row) => (
                  <tr key={row.teacher_id} className="border-b border-zinc-100">
                    <td className="px-3 py-2">{row.full_name || row.email || "Teacher"}</td>
                    <td className="px-3 py-2">{row.course_count}</td>
                    <td className="px-3 py-2">{row.student_count}</td>
                    <td className="px-3 py-2">{Math.round(row.completion_rate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {engagement.data ? (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Lesson completion</h2>
          {engagement.data.courses.length === 0 ? <Empty>No published courses.</Empty> : null}
          {engagement.data.courses.map((course) => (
            <div key={course.course_id}>
              <h3 className="mb-2 font-medium">{course.title}</h3>
              {course.lessons.length === 0 ? (
                <Empty>No lessons.</Empty>
              ) : (
                <div className="h-64 w-full rounded-lg border border-zinc-200 bg-white p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={course.lessons.map((lesson) => ({
                        name: lesson.title,
                        count: lesson.completed_count,
                      }))}
                      layout="vertical"
                      margin={{ left: 24, right: 8 }}
                    >
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="name" width={120} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1d4ed8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Chart({ title, data }: { title: string; data: DayCount[] }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {data.length === 0 ? (
        <Empty>No data in this window.</Empty>
      ) : (
        <div className="h-64 w-full rounded-lg border border-zinc-200 bg-white p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="day" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#1d4ed8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
