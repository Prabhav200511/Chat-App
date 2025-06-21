import React, { useEffect } from 'react'
import Navbar from "./components/Navbar"
import HomePage from './pages/HomePage'
import SignUpPage from './pages/SignUpPage' 
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'

import {Routes,Route, Navigate} from "react-router-dom"
import { useAuthStore } from './store/useAuthStore'
import { useThemeStore } from './store/useThemeStore'
import { Loader} from "lucide-react"
import {Toaster} from "react-hot-toast"

const App = () => {

  const {authUser,checkAuth,isCheckingAuth,onlineUsers} = useAuthStore()
  const {theme} = useThemeStore();
  useEffect(() =>{
    checkAuth()
  },[checkAuth])

  console.log(onlineUsers);

  if(isCheckingAuth) return(
    <div className='flex items-center justify-center h-screen'>
      <Loader className="size-10 animate-spin"/>
    </div>
  )

  return (
     <div data-theme={theme}>
      <Navbar />
      <Routes>
        <Route path='/' element={authUser ? <HomePage /> : <Navigate to="/login"/>} />
        <Route path='/signup' element={authUser ? <Navigate to="/" /> : <SignUpPage/>} />
        <Route path='/login' element={authUser ? <Navigate to="/" /> : <LoginPage/>} />
        <Route path='/settings' element={authUser ? <SettingsPage/> : <Navigate to="/login"/>} />
        <Route path='/profile' element={authUser ? <ProfilePage /> : <Navigate to="/login"/>} />
      </Routes>
      
      <Toaster/>
    </div>
  )
}

export default App