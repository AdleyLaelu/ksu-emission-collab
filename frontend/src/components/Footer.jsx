import React from "react";
import futraLogo from "../assets/futra-logo.png";
import ksuLogo from "../assets/ksu-logo.png";

const Footer = () => {
  return (
    <footer className="bg-white px-8 py-4 flex justify-between items-center z-[1000]">
      <div className="flex items-center">
        <img
          src={futraLogo}
          alt="Futra Lab"
          style={{ width: "180px", height: "auto" }}
        />
      </div>
      <div className="flex items-center">
        <img
          src={ksuLogo}
          alt="Kennesaw State University"
          style={{ width: "120px", height: "auto" }}
        />
      </div>
    </footer>
  );
};

export default Footer;
