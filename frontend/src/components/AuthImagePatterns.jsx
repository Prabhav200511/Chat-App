import { Sparkles } from "lucide-react";

const AuthImagePattern = ({ title, subtitle }) => {
  return (
    <div className="hidden lg:flex items-center justify-center bg-base-300 p-12">
      <div className="max-w-md text-center space-y-8">
        {/* Icon and Glow Effect */}
        <div className="relative mb-6" style={{ height: "25vh" }}>
          <div className="absolute inset-0 flex justify-center items-center">
            <div className="w-[220px] h-[220px] rounded-full blur-[90px] animate-pulse bg-base-200" />
          </div>
          <div className="relative z-10 flex justify-center items-center h-full">
            <div className="w-28 h-28 border rounded-3xl flex items-center justify-center shadow-xl">
              <Sparkles className="w-12 h-12" />
            </div>
          </div>
        </div>

        <h2 className="text-2xl font-semibold  tracking-tight">{title}</h2>
        <p className="text-smleading-relaxed">{subtitle}</p>
      </div>
    </div>
  );
};

export default AuthImagePattern;