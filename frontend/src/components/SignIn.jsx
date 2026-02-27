// 📝 SignIn.js - Updated with Login Authentication
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { API_URL } from "../config";
// import useAuthStore from "../utilities/authStore";

const SignIn = () => {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();
  //   const { loginUser } = useAuthStore();
  const navigate = useNavigate();


  const onSubmit = async (data) => {
    try {
      // Send login ID to backend
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: data.username, password: data.password })
      });
      if (!res.ok) throw new Error('Login API error');
      // Optionally handle response here
      const responseData = await res.json();
      window.dispatchEvent(
        new CustomEvent("app-notification", { detail: { text: "Login successful!" } })
      );
      navigate("/"); // Redirect to home or dashboard after successful login
    } catch {
      window.dispatchEvent(
        new CustomEvent("app-notification", { detail: { text: "Login failed. Please check your credentials." } })
      );
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 min-h-[75vh] min-w-[500px]">
      <h2 className="text-2xl font-bold mb-4">Sign In</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            type="text"
            id="email"
            {...register("username", {
              required: "Email is required",
              pattern: {
                value: /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/,
                message: "Invalid email address",
              },
            })}
            className="mt-2 p-2 w-full border border-gray-300 rounded-md"
          />
          {errors.email && (
            <span className="text-red-500 text-xs mt-1">
              {errors.email.message}
            </span>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            type="password"
            id="password"
            {...register("password", {
              required: "Password is required",
              minLength: {
                value: 6,
                message: "Password must be at least 6 characters long",
              },
            })}
            className="mt-2 p-2 w-full border border-gray-300 rounded-md"
          />
          {errors.password && (
            <span className="text-red-500 text-xs mt-1">
              {errors.password.message}
            </span>
          )}
        </div>

        <div>
          <button
            type="submit"
            className="w-full py-2 bg-black text-white rounded-md hover:bg-gray-800 transition"
          >
            Sign In
          </button>
        </div>
      </form>

      <div className="mt-4 text-center">
        <p className="text-sm">
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="text-blue-600 hover:underline">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
};

export default SignIn;
