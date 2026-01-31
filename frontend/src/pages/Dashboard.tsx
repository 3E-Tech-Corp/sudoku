import { useAuth } from '../contexts/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-gray-400 text-sm font-medium">Welcome</h3>
          <p className="text-2xl font-bold text-white mt-2">{user?.username}</p>
          <p className="text-gray-400 text-sm mt-1">Role: {user?.role}</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-gray-400 text-sm font-medium">Status</h3>
          <p className="text-2xl font-bold text-green-400 mt-2">Online</p>
          <p className="text-gray-400 text-sm mt-1">All systems operational</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-gray-400 text-sm font-medium">Quick Start</h3>
          <p className="text-white mt-2 text-sm">
            This is a template project. Customize this dashboard for your application.
          </p>
        </div>
      </div>
    </div>
  );
}
