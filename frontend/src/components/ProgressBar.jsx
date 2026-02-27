import React from 'react';

const ProgressBar = () => {
  return (
    <div className="flex justify-center items-center mt-4">
      <div className="flex space-x-4">
        <div className="px-4 py-2 border-2 border-green-500 rounded">Input Data</div>
        <div className="px-4 py-2 border-2 border-green-500 rounded">Analysis</div>
        <div className="px-4 py-2 border-2 border-green-500 rounded">Results</div>
      </div>
      <button className="ml-4 bg-blue-200 px-4 py-2 rounded" disabled>Start</button>
    </div>
  );
};

export default ProgressBar;
