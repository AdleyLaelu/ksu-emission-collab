import React from "react";
import Notifications from "./Notifications";
import { Link } from "react-router-dom";
import HomeIcon from "@mui/icons-material/Home";
import { IconButton } from "@mui/material";
import headerBg from "../assets/headerBg.jpeg";
import useAppStore from "../useAppStore";

const Header = () => {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <header
      className={`p-4 flex items-center justify-between transition-colors duration-300 ${
        theme === "dark" ? "bg-[#163e73] text-white" : "bg-[#e3f0ff] text-black"
      }`}
      style={{
        borderBottom: "1px solid #ccc",
        backgroundImage: `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.15)), url(${headerBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        // optional: stronger overlay when dark
        filter: theme === "dark" ? "saturate(0.9)" : undefined,
      }}
    >
      <Link to={"/"} reloadDocument>
        <IconButton aria-label="home" style={{ background: 'transparent' }}>
          <HomeIcon
            style={{ color: '#1A237E', background: 'transparent' }}
          />
        </IconButton>
      </Link>

      <div className="flex flex-col items-center gap-4">
        <h1
          className="text-3xl font-bold transition-colors duration-300"
          style={{ color: '#1A237E' }}
        >
          Transportation Energy and Emission Modeling and Analysis Tool
        </h1>
        <Notifications />
      </div>

      <div className="flex flex-col items-center gap-4">
        {/* <Link
          to={"/signin"}
          className={`font-semibold py-1 px-4 rounded-md border transition-colors duration-300 ${
            theme === "dark"
              ? "bg-[#18181b] text-white border-white"
              : "bg-white text-black border-black"
          }`}
        >
          Sign In
        </Link> */}
        {/* <div className="flex items-center ml-2">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={theme === "dark"}
              onChange={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer dark:bg-gray-700 peer-checked:bg-blue-600 transition-all"></div>
            <span className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-5 dark:bg-gray-300"></span>
          </label>
          <span
            className={`ml-2 text-sm font-medium uppercase transition-colors`}
            style={{ color: '#1A237E' }}
          >
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </span>
        </div> */}
      </div>
    </header>
  );
};

export default Header;
