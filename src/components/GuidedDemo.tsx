import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Play, X, ChevronRight, ChevronLeft, LayoutDashboard, UserCheck, 
  Ship, Settings2, Sparkles, CheckCircle2 
} from "lucide-react";

interface DemoStep {
  title: string;
  description: string;
  route: string;
  icon: React.ElementType;
  highlight?: string;
  details: string[];
}

const demoSteps: DemoStep[] = [
  {
    title: "Operations Dashboard",
    description: "Your command center for real-time cruise operations intelligence.",
    route: "/",
    icon: LayoutDashboard,
    details: [
      "Live KPIs track guest satisfaction, revenue protection, and incident response",
      "Ship status bar shows vessel info, weather, and voyage progress",
      "Agent workspace cards link directly to each AI agent with alert counts",
      "Animated charts visualize satisfaction trends, revenue, and agent confidence",
    ],
  },
  {
    title: "Guest Recovery Agent",
    description: "AI-powered detection and resolution of guest service failures.",
    route: "/guest-recovery",
    icon: UserCheck,
    details: [
      "Monitors all guest interactions for service failures in real time",
      "Automatically calculates compensation using sentiment analysis and guest value",
      "Presents prioritized recommendations with confidence scores",
      "Tracks full incident lifecycle from detection to resolution",
    ],
  },
  {
    title: "Port & Excursion Agent",
    description: "Proactive management of port disruptions and excursion rebooking.",
    route: "/port-disruption",
    icon: Ship,
    details: [
      "Integrates weather, port authority, and vendor data for disruption prediction",
      "Auto-generates alternative excursion options when cancellations occur",
      "Calculates financial impact and suggests revenue-preserving alternatives",
      "Manages guest communications and rebooking workflows end-to-end",
    ],
  },
  {
    title: "Onboard Ops Agent",
    description: "Real-time optimization of venue capacity, staffing, and maintenance.",
    route: "/onboard-ops",
    icon: Settings2,
    details: [
      "Live venue utilization monitoring with occupancy and wait-time tracking",
      "Intelligent staff redeployment recommendations based on demand patterns",
      "Predictive maintenance flagging to prevent service interruptions",
      "Cross-venue load balancing to eliminate bottlenecks and overflows",
    ],
  },
];

export function GuidedDemo() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [hasCompleted, setHasCompleted] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const step = demoSteps[currentStep];
  const progress = ((currentStep + 1) / demoSteps.length) * 100;

  useEffect(() => {
    if (isOpen) {
      navigate(step.route);
    }
  }, [currentStep, isOpen]);

  const handleNext = () => {
    if (currentStep < demoSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setHasCompleted(true);
      setTimeout(() => {
        setIsOpen(false);
        setCurrentStep(0);
        setHasCompleted(false);
      }, 2500);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleClose = () => {
    setIsOpen(false);
    setCurrentStep(0);
    setHasCompleted(false);
  };

  // Floating trigger button
  if (!isOpen) {
    return (
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1, type: "spring", stiffness: 200 }}
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg hover:shadow-xl transition-shadow"
      >
        <Play className="h-4 w-4" />
        Guided Demo
      </motion.button>
    );
  }

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Demo Panel */}
      <motion.div
        initial={{ x: 400, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 400, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">Guided Demo</span>
            </div>
            <button onClick={handleClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-secondary">
              <motion.div
                className="h-full rounded-full bg-primary"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {currentStep + 1}/{demoSteps.length}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-5">
          <AnimatePresence mode="wait">
            {hasCompleted ? (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-16 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", delay: 0.2 }}
                >
                  <CheckCircle2 className="h-16 w-16 text-success mb-4" />
                </motion.div>
                <h2 className="text-xl font-bold text-foreground mb-2">Demo Complete!</h2>
                <p className="text-sm text-muted-foreground">
                  You've explored all VoyageOps AI agent workspaces.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                {/* Step Icon & Title */}
                <div className="flex items-start gap-3 mb-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{step.title}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{step.description}</p>
                  </div>
                </div>

                {/* Key Features */}
                <div className="rounded-lg border border-border bg-muted/50 p-4 mb-5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Key Capabilities
                  </p>
                  <div className="space-y-3">
                    {step.details.map((detail, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + i * 0.1 }}
                        className="flex items-start gap-2.5"
                      >
                        <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="text-sm text-foreground leading-relaxed">{detail}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Step indicator dots */}
                <div className="flex justify-center gap-2 mb-5">
                  {demoSteps.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentStep(i)}
                      className={`h-2 rounded-full transition-all ${
                        i === currentStep ? "w-6 bg-primary" : "w-2 bg-secondary hover:bg-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Navigation */}
        {!hasCompleted && (
          <div className="sticky bottom-0 border-t border-border bg-card/95 backdrop-blur-sm p-4 flex items-center justify-between">
            <button
              onClick={handlePrev}
              disabled={currentStep === 0}
              className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {currentStep === demoSteps.length - 1 ? "Finish" : "Next"}
              {currentStep < demoSteps.length - 1 && <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
