import React from "react";

const Footer = () => {
  return (
    <footer className="bg-white px-8 py-4 flex justify-between items-center z-[1000]">
      <div className="flex items-center">
        <img
          src="src/assets/futra-logo.png"
          alt="Futra Lab"
          style={{ width: "180px", height: "auto" }}
        />
      </div>
      <div className="flex items-center">
        <img
          src="src/assets/ksu-logo.png"
          alt="Kennesaw State University"
          style={{ width: "120px", height: "auto" }}
        />
      </div>
    </footer>
  );
};

export default Footer;
