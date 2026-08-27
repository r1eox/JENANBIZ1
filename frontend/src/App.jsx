import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import Requests from './pages/Requests';
import Users from './pages/Users';
import Brokers from './pages/Brokers';
import Companies from './pages/Companies';
import Settings from './pages/Settings';
import Attendance from './pages/Attendance';
import AttendanceAdmin from './pages/AttendanceAdmin';
import PerformanceAdmin from './pages/PerformanceAdmin';
import Reports from './pages/Reports';
import Eligibility from './pages/Eligibility';
import Commissions from './pages/Commissions';
import Establishments from './pages/Establishments';
import Accounting from './pages/Accounting';

class RuntimeRecoveryBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('RuntimeRecoveryBoundary caught an error:', error);
  }

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6" dir="rtl">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-black text-gray-900">حدث خطأ أثناء تحميل الصفحة</h1>
          <p className="mt-2 text-sm leading-7 text-gray-500">
            غالباً تم نشر تحديث جديد بينما كانت الصفحة مفتوحة. اضغط تحديث لإعادة تحميل النسخة الأحدث.
          </p>
          <button
            onClick={this.handleRefresh}
            className="mt-5 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700"
          >
            تحديث الصفحة
          </button>
        </div>
      </div>
    );
  }
}

function PrivateRoute({ children, adminOnly = false, permission = null, anyPermissions = [] }) {
  const { user, loading, token, hasPermission, hasAnyPermission } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!token) return <Navigate to="/login" replace />;
  if (adminOnly && user?.role !== 'admin') return <Navigate to="/dashboard" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/dashboard" replace />;
  if (anyPermissions.length > 0 && !hasAnyPermission(anyPermissions)) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/register" element={token ? <Navigate to="/dashboard" replace /> : <Register />} />
      <Route path="/forgot-password" element={token ? <Navigate to="/dashboard" replace /> : <ForgotPassword />} />

      <Route path="/dashboard" element={
        <PrivateRoute><Layout><Dashboard /></Layout></PrivateRoute>
      } />
      <Route path="/requests" element={
        <PrivateRoute><Layout><Requests /></Layout></PrivateRoute>
      } />
      <Route path="/brokers" element={
        <PrivateRoute><Layout><Brokers /></Layout></PrivateRoute>
      } />
      <Route path="/companies" element={
        <PrivateRoute permission="manage_funding"><Layout><Companies /></Layout></PrivateRoute>
      } />
      <Route path="/users" element={
        <PrivateRoute anyPermissions={['manage_users', 'approve_users', 'manage_user_permissions']}><Layout><Users /></Layout></PrivateRoute>
      } />
      <Route path="/settings" element={
        <PrivateRoute permission="manage_settings"><Layout><Settings /></Layout></PrivateRoute>
      } />
      <Route path="/attendance" element={
        <PrivateRoute><Layout><Attendance /></Layout></PrivateRoute>
      } />
      <Route path="/attendance-admin" element={
        <PrivateRoute anyPermissions={['view_attendance_admin', 'delete_attendance_records']}><Layout><AttendanceAdmin /></Layout></PrivateRoute>
      } />
      <Route path="/performance" element={
        <PrivateRoute permission="view_performance"><Layout><PerformanceAdmin /></Layout></PrivateRoute>
      } />
      <Route path="/reports" element={
        <PrivateRoute permission="view_reports"><Layout><Reports /></Layout></PrivateRoute>
      } />
      <Route path="/eligibility" element={
        <PrivateRoute><Layout><Eligibility /></Layout></PrivateRoute>
      } />
      <Route path="/commissions" element={
        <PrivateRoute><Layout><Commissions /></Layout></PrivateRoute>
      } />
      <Route path="/accounting" element={
        <PrivateRoute><Layout><Accounting /></Layout></PrivateRoute>
      } />
      <Route path="/establishments" element={
        <PrivateRoute permission="manage_establishments"><Layout><Establishments /></Layout></PrivateRoute>
      } />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RuntimeRecoveryBoundary>
        <AppRoutes />
      </RuntimeRecoveryBoundary>
    </AuthProvider>
  );
}
