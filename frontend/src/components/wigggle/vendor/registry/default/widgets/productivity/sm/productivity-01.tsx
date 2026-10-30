import AppControl from "@/components/ui/AppButton";


import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import React from "react";

import { Label } from "@/components/wigggle/vendor/components/ui/label";
import {
  Widget,
  WidgetContent,
  WidgetHeader,
  WidgetTitle,
} from "@/components/wigggle/vendor/registry/default/ui/widget";

interface TodoType {
  id: number;
  task: string;
  completed: boolean;
}

const initialTodos = [
  { completed: true, id: 1, task: "Refactor code" },
  { completed: true, id: 2, task: "Review designs" },
  { completed: false, id: 3, task: "Testing" },
  { completed: false, id: 4, task: "Deployment" },
];

const WidgetDemo = () => {
  const [todos, setTodos] = React.useState<TodoType[]>(initialTodos);

  const handleToggle = (id: number) => {
    setTodos((prevTodos) => {
      const updatedTodos = prevTodos.map((todo) => {
        if (todo.id === id) {
          return { ...todo, completed: !todo.completed };
        }
        return todo;
      });
      return updatedTodos;
    });
  };

  return (
    <Widget className="gap-2" design="mumbai">
      <WidgetHeader className="justify-center">
        <WidgetTitle>Tasks</WidgetTitle>
      </WidgetHeader>
      <WidgetContent className="flex-col gap-0">
        {todos.map((todo) => (
          <AppControl variant="unstyled"
            type="button"
            className="w-full"
            onClick={() => handleToggle(todo.id)}
            key={todo.id}
          >
            <div className="hover:bg-muted group flex w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-sm hover:cursor-pointer">
              {todo.completed ? (
                <CheckCircle2Icon className="text-productive size-4" />
              ) : (
                <CircleIcon className="text-muted-foreground size-4" />
              )}
              <Label
                size="sm"
                variant="muted-foreground"
                className="group-hover:cursor-pointer"
              >
                <span
                  className={
                    todo.completed
                      ? "text-muted-foreground/70 line-through"
                      : ""
                  }
                >
                  {todo.task}
                </span>
              </Label>
            </div>
          </AppControl>
        ))}
      </WidgetContent>
    </Widget>
  );
};

export default WidgetDemo;
