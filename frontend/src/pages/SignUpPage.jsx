import React, { useState } from 'react'
import { useAuthStore } from '../store/useAuthStore';
import { Eye,EyeOff,Loader2,Lock,Mail,MessageSquare,User } from 'lucide-react';
import AuthImagePattern from "../components/AuthImagePatterns"
import { Link } from 'react-router-dom';
import {toast} from "react-hot-toast"

const SignUpPage = () => {
  const [showPassword,setShowPassword] = useState(false);
  const [formData,setFormData] = useState({
    fullName:"",
    email:"",
    password:""
  })

  const {signup, isSigningUp} = useAuthStore();

  const validateForm = () => {
    if(!formData.fullName.trim()) return toast.error("Full name is required");
    if(!formData.email.trim()) return toast.error("Email is required");
    if(!/\S+@\S+\.|S+/.test(formData.email)) return toast.error("Invalid email format");
    if(!formData.password) return toast.error("Password is required");
    if(formData.password.length<6) return toast.error("Password too short");

    return true;
  }

  const handleSubmit = (e) => 
  {
    e.preventDefault();
    const success = validateForm();

    if(success===true){
      signup(formData);
    }
    
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-3 bg-[#dad0c1] text-[#5C5048]">
    {/* left side */}
    <div className="flex flex-col justify-center items-center px-6 sm:px-12 col-span-2">
      <div className="w-full max-w-md space-y-8">
        {/* LOGO */}
        <div className="text-center mb-10">
          <div className="flex flex-col items-center gap-2 group">
            <div className="size-12 rounded-lg bg-[#E8DED1] flex items-center justify-center transition-colors">
              <MessageSquare className="size-5 text-[#5C5552]" />
            </div>
            <h1 className="text-2xl font-semibold mt-2 tracking-tight text-[#433633]">
              Create Account
            </h1>
            <p className="text-sm text-[#8F857D]">Get started with your free account</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Full Name */}
          <div className="form-control">
            <label className="label mb-1 text-sm font-medium text-[#433633]">Full Name</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="size-4 text-[#B4A69A]" />
              </div>
              <input
                type="text"
                className="input w-full pl-10 py-2 border border-[#E0D6CC] bg-white text-[#433633] rounded-md focus:outline-none focus:ring-2 focus:ring-[#C7B7A4]/50 focus:border-[#C7B7A4] transition"
                placeholder="John Doe"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              />
            </div>
          </div>

          {/* Email */}
          <div className="form-control">
            <label className="label mb-1 text-sm font-medium text-[#433633]">Email</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail className="size-4 text-[#B4A69A]" />
              </div>
              <input
                type="email"
                className="input w-full pl-10 py-2 border border-[#E0D6CC] bg-white text-[#433633] rounded-md focus:outline-none focus:ring-2 focus:ring-[#C7B7A4]/50 focus:border-[#C7B7A4] transition"
                placeholder="you@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          {/* Password */}
          <div className="form-control">
            <label className="label mb-1 text-sm font-medium text-[#433633]">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="size-4 text-[#B4A69A]" />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                className="input w-full pl-10 py-2 pr-10 border border-[#E0D6CC] bg-white text-[#433633] rounded-md focus:outline-none focus:ring-2 focus:ring-[#C7B7A4]/50 focus:border-[#C7B7A4] transition"
                placeholder="••••••••"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#B4A69A]"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="btn w-full bg-[#5C5552] text-white hover:bg-[#433633] transition disabled:opacity-50"
            disabled={isSigningUp}
          >
            {isSigningUp ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Loading...
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        {/* Login Redirect */}
        <div className="text-center mt-6">
          <p className="text-sm text-[#8F857D]">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-[#5C5048] font-medium underline hover:text-[#433633] transition"
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>

    {/* right side */}
    <AuthImagePattern
      title="Join our community"
      subtitle="Connect with friends, share moments, and stay in touch with your loved ones."
    />
  </div>


  );
};


export default SignUpPage;